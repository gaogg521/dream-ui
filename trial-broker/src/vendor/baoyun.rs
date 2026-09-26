//! Baoyun (`ai.baoyun.com`) as a [`TokenVendor`].
//!
//! Verified against the live docs (2026-09-20), not guessed. Baoyun added an
//! "account API" specifically in response to the questions this broker's
//! earlier metered-proxy design (`crate::metered::baoyun`, mode B) raised —
//! it now supports everything [`ProvisioningMode::IssuedKey`] needs:
//!
//! - `POST /apis/v1/api-keys` with `{name, currency, remain, unlimited, ...}`
//!   → `201 {id, key, ...}`. The plaintext `key` (`sk-...`) appears here and
//!   nowhere else, ever.
//! - `GET /apis/v1/api-keys/{id}` reads `remain`/`used`/`unlimited`/`status`;
//!   `PATCH` the same path changes them; `DELETE` revokes. All addressed by
//!   **id** (a string), which is what lets this service manage keys it never
//!   stored the plaintext of.
//! - This account API is a *different credential* from the model-call `sk-`
//!   key: a "system access token" generated on Baoyun's console settings
//!   page, sent as `Authorization: Bearer <token>` with no `sk-` prefix.
//! - Exhaustion surfaces to the end user as `401 token_quota_exhausted` (or
//!   `403 pre_consume_token_quota_failed` / `insufficient_user_quota`) when
//!   *they* call `/v1/*` with the issued key — this broker never sees that,
//!   it only reads `remain`/`used` back via the account API.
//! - Baoyun has no OpenRouter-style "renews every period" cap. `remain` is a
//!   prepaid balance that only moves when spent or explicitly topped up, so
//!   every Baoyun key this broker issues uses [`ResetPeriod::Cumulative`].
//!   `daily_limit`/`monthly_limit` are a separate, additional rate-limit
//!   knob this broker does not use for the trial offer.
//! - `GET /apis/v1/models` (catalog) and `GET /apis/v1/pricing` (per-model
//!   pricing), live since 2026-09-22, are what `issue_key` uses to pick the
//!   trial model instead of a hardcoded id — join by `id`, filter to
//!   token-billed models tagged `output.text` and nothing else `output.*`,
//!   take the cheapest by `input + output`. See `pick_cheapest_text_model`.
//! - `POST /apis/v1/topup/orders` / `GET /apis/v1/topup/orders/{id}`, also
//!   live since 2026-09-22: real-money top-up via a scan-to-pay QR order.
//!   The money always lands in **this account's shared balance**, never a
//!   specific key — there is no "top up this key" concept on Baoyun's side,
//!   only `reference` (an opaque string this broker sets and gets back
//!   unchanged) for tying an order back to the install that created it. See
//!   `crate::topup` for how that reference is used to route the eventual
//!   `top_up` call to the right key.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, TopupOrder,
    TopupOrderSpec, TopupOrderStatus, UsageLogEntry, UsageLogKind, VendorClientConfig, VendorError,
};

pub const ID: &str = "baoyun";
/// Where the end user's issued key talks to for inference. OpenAI-compatible.
pub const BASE_URL: &str = "https://ai-api.baoyun.com/v1";
/// Where *this broker* talks to manage keys. A different path on the same
/// host, gated by the system access token rather than an `sk-` key.
const ACCOUNT_API_BASE: &str = "https://ai-api.baoyun.com/apis/v1";
/// No dedicated client-side platform for Baoyun — same treatment mode B gave
/// it, since it is an OpenAI-compatible custom endpoint, not a first-class
/// platform the desktop client knows by name.
pub const PLATFORM: &str = "custom";
pub const CURRENCY: &str = "CNY";

/// Text-generation output tag in Baoyun's model catalog (`GET /apis/v1/models`,
/// live since 2026-09-22). A model qualifies for the trial offer if it has
/// this tag and none of the other `output.*` tags below — that admits vision
/// *input* and deep-thinking models (still plain text out), and excludes
/// image/video/audio generation.
const TAG_OUTPUT_TEXT: &str = "output.text";
const NON_TEXT_OUTPUT_TAGS: &[&str] = &["output.image", "output.video", "output.audio"];
/// Only token-metered models sort sensibly against `input + output` — a
/// per-second or per-image billing scheme isn't comparable on that axis, and
/// in practice won't have `output.text` anyway.
const TOKEN_BILLING: &str = "token";

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PricingListResponse {
    data: Vec<PricingEntry>,
}

#[derive(Debug, Deserialize)]
struct PricingEntry {
    id: String,
    #[serde(default)]
    billing: String,
    #[serde(default)]
    input: f64,
    #[serde(default)]
    output: f64,
}

/// Picks the cheapest (input + output, per 1M tokens) text-generation model
/// this account can currently see. Pure and unit-tested separately from the
/// two live HTTP calls that feed it (`BaoyunVendor::fetch_cheapest_text_model`).
fn pick_cheapest_text_model(models: &[ModelEntry], pricing: &[PricingEntry]) -> Option<String> {
    models
        .iter()
        .filter(|m| {
            m.tags.iter().any(|t| t == TAG_OUTPUT_TEXT)
                && !m
                    .tags
                    .iter()
                    .any(|t| NON_TEXT_OUTPUT_TAGS.contains(&t.as_str()))
        })
        .filter_map(|m| {
            let price = pricing
                .iter()
                .find(|p| p.id == m.id && p.billing == TOKEN_BILLING)?;
            Some((m.id.clone(), price.input + price.output))
        })
        .min_by(|(_, a), (_, b)| a.total_cmp(b))
        .map(|(id, _)| id)
}

#[derive(Debug, Serialize)]
struct CreateKeyBody {
    name: String,
    currency: &'static str,
    remain: f64,
    unlimited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    expired_time: Option<i64>,
    /// Server-side model whitelist — makes the trial model list an actual
    /// cap, not just what the client happens to offer.
    model_limits_enabled: bool,
    model_limits: Vec<String>,
}

#[derive(Debug, Serialize)]
struct PatchRemainBody {
    currency: &'static str,
    remain: f64,
}

#[derive(Debug, Serialize)]
struct PatchRemainDeltaBody {
    currency: &'static str,
    remain_delta: f64,
}

/// Model-tier move on an existing token. Sent with the same PATCH endpoint
/// that carries [`PatchRemainBody`] — Baoyun's token edit accepts partial
/// bodies, so a model-tier change never has to touch `remain` (verified
/// against the live API: `model_limits_enabled: false` alone lifts the
/// whitelist; the stale `model_limits` list is then ignored).
#[derive(Debug, Serialize)]
struct PatchModelsBody {
    currency: &'static str,
    model_limits_enabled: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    model_limits: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CreateKeyResponse {
    id: String,
    key: String,
}

#[derive(Debug, Deserialize)]
struct KeyDetail {
    status: i64,
    remain: f64,
    used: f64,
    unlimited: bool,
    /// Already present on every real response, just unused until
    /// `key_alive_models` needed to hand it back to a recovering client.
    #[serde(default)]
    model_limits: Vec<String>,
}

impl From<KeyDetail> for KeyUsage {
    fn from(data: KeyDetail) -> Self {
        Self {
            limit_usd: (!data.unlimited).then_some(data.remain + data.used),
            used_usd: data.used,
            remaining_usd: (!data.unlimited).then_some(data.remain),
            reset: Some(ResetPeriod::Cumulative),
            // 1 enabled, 2 disabled, 3 expired, 4 exhausted — anything but 1
            // means the key cannot be used right now.
            disabled: data.status != 1,
            currency: CURRENCY.to_string(),
        }
    }
}

#[derive(Debug, Serialize)]
struct CreateTopupOrderBody {
    /// Always sent explicitly rather than omitted — `online` happens to be
    /// the only method Baoyun offers today, but a future silent addition of
    /// a second method must not change what this broker asks for.
    method: &'static str,
    amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotency_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TopupOrderResponseBody {
    id: String,
    status: String,
    currency: String,
    amount: f64,
    #[serde(default)]
    reference: Option<String>,
    #[serde(default)]
    qr_code: Option<String>,
    #[serde(default)]
    expires_at: Option<i64>,
    #[serde(default)]
    completed_at: Option<i64>,
}

/// A page of `GET /topup/orders` — used only by `paid_total`'s recovery
/// arithmetic, never by the create/get-one paths above.
#[derive(Debug, Deserialize)]
struct TopupOrderListResponseBody {
    data: Vec<TopupOrderResponseBody>,
    has_more: bool,
}

/// Empty JSON body for `POST /api-keys/{id}/key` — the endpoint takes no
/// parameters, but still expects a `{}` body per its own docs example.
#[derive(Debug, Serialize)]
struct RevealKeyBody {}

#[derive(Debug, Deserialize)]
struct RevealKeyResponse {
    key: String,
}

/// The "how much has this reference truly paid" arithmetic behind
/// `paid_total`, kept separate from the HTTP/pagination wrapper so it can be
/// unit tested against fixture data without a live account. Filters to
/// `success` itself rather than trusting the `status=success` query param
/// alone — the same order list is also usable unfiltered, and a caller
/// passing unfiltered data here must not have it silently double-counted.
fn sum_successful_topups(orders: &[TopupOrderResponseBody]) -> f64 {
    orders
        .iter()
        .filter(|o| o.status == "success")
        .map(|o| o.amount)
        .sum()
}

/// One row of `GET /apis/v1/logs` (用量日志). `token_id` is the same opaque
/// id this broker stores as `Issuance::vendor_key_handle` — the endpoint
/// itself only filters by `token_name` (exact match), not id, so
/// `usage_logs` pulls unfiltered pages and matches on `token_id` itself
/// rather than needing to know a key's vendor-side name.
#[derive(Debug, Deserialize)]
struct LogEntry {
    id: String,
    #[serde(rename = "type")]
    log_type: i32,
    created: i64,
    model: String,
    token_id: String,
    amount: f64,
    #[serde(default)]
    prompt_tokens: i64,
    #[serde(default)]
    completion_tokens: i64,
    #[serde(default)]
    use_time: i64,
    request_id: String,
    #[serde(default)]
    is_stream: bool,
}

#[derive(Debug, Deserialize)]
struct LogListResponseBody {
    data: Vec<LogEntry>,
    has_more: bool,
}

impl TryFrom<LogEntry> for UsageLogEntry {
    type Error = VendorError;

    fn try_from(entry: LogEntry) -> Result<Self, VendorError> {
        let kind = UsageLogKind::parse(entry.log_type).ok_or_else(|| VendorError::Request {
            vendor: ID,
            message: format!("unrecognised usage log type `{}`", entry.log_type),
        })?;
        Ok(Self {
            id: entry.id,
            kind,
            created_at: entry.created,
            model: entry.model,
            amount: entry.amount,
            prompt_tokens: entry.prompt_tokens,
            completion_tokens: entry.completion_tokens,
            use_time_ms: entry.use_time,
            request_id: entry.request_id,
            is_stream: entry.is_stream,
        })
    }
}

/// The "which of these log entries belong to this key" filter behind
/// `usage_logs`, kept separate from the HTTP/pagination wrapper so it can be
/// unit tested against fixture data without a live account.
fn filter_logs_for_handle(
    entries: Vec<LogEntry>,
    handle: &str,
) -> Result<Vec<UsageLogEntry>, VendorError> {
    entries
        .into_iter()
        .filter(|e| e.token_id == handle)
        .map(UsageLogEntry::try_from)
        .collect()
}

impl TryFrom<TopupOrderResponseBody> for TopupOrder {
    type Error = VendorError;

    fn try_from(body: TopupOrderResponseBody) -> Result<Self, VendorError> {
        let status = TopupOrderStatus::parse(&body.status).ok_or_else(|| VendorError::Request {
            vendor: ID,
            message: format!("unrecognised topup order status `{}`", body.status),
        })?;
        Ok(Self {
            id: body.id,
            status,
            currency: body.currency,
            amount: body.amount,
            reference: body.reference,
            qr_code: body.qr_code,
            expires_at: body.expires_at,
            completed_at: body.completed_at,
        })
    }
}

pub struct BaoyunVendor {
    http: reqwest::Client,
    access_token: String,
    account_api_base: String,
}

impl BaoyunVendor {
    pub fn new(access_token: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            access_token,
            account_api_base: ACCOUNT_API_BASE.to_string(),
        }
    }

    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        builder: reqwest::RequestBuilder,
    ) -> Result<T, VendorError> {
        let resp = builder
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| VendorError::Request {
                vendor: ID,
                message: e.to_string(),
            })?;

        let status = resp.status();
        if !status.is_success() {
            return Err(VendorError::Upstream {
                vendor: ID,
                status: status.as_u16(),
                body: resp.text().await.unwrap_or_default(),
            });
        }

        resp.json::<T>().await.map_err(|e| VendorError::Request {
            vendor: ID,
            message: e.to_string(),
        })
    }

    /// Live catalog + pricing lookup, joined down to the single cheapest
    /// text-generation model this account can currently see. Two extra
    /// account-API calls, made once per issuance — trial issuance is
    /// low-frequency (the daily circuit breaker caps it at ~50/day), so this
    /// trades a little latency for never drifting from what Baoyun actually
    /// offers, which is the whole point: a hardcoded model id goes stale the
    /// day Baoyun delists or re-prices it.
    async fn fetch_cheapest_text_model(&self) -> Result<String, VendorError> {
        let models: ModelListResponse = self
            .request(self.http.get(format!("{}/models", self.account_api_base)))
            .await?;
        let pricing: PricingListResponse = self
            .request(self.http.get(format!(
                "{}/pricing?currency={CURRENCY}",
                self.account_api_base
            )))
            .await?;

        pick_cheapest_text_model(&models.data, &pricing.data).ok_or_else(|| VendorError::Request {
            vendor: ID,
            message: "no token-billed text-generation model found in Baoyun's catalog".into(),
        })
    }

    /// The trial model list to advertise to the client *and* whitelist
    /// server-side on the issued key — one resolution feeds both, so they
    /// can never disagree. `BAOYUN_TRIAL_MODELS` is an operator override
    /// (skips the live lookup entirely, e.g. to pin a model or route around
    /// a catalog-API outage); unset, it always defers to Baoyun's own current
    /// cheapest text model rather than a value baked into this binary.
    async fn resolve_trial_models(&self) -> Result<Vec<String>, VendorError> {
        match std::env::var("BAOYUN_TRIAL_MODELS") {
            Ok(v) => Ok(v
                .split(',')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()),
            Err(_) => Ok(vec![self.fetch_cheapest_text_model().await?]),
        }
    }
}

#[async_trait]
impl TokenVendor for BaoyunVendor {
    fn id(&self) -> &'static str {
        ID
    }

    fn provisioning_mode(&self) -> ProvisioningMode {
        ProvisioningMode::IssuedKey
    }

    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: PLATFORM,
            base_url: BASE_URL,
            currency: CURRENCY,
        }
    }

    async fn issue_key(&self, spec: KeySpec) -> Result<IssuedKey, VendorError> {
        // Baoyun has no periodic reset for `remain` — it is a prepaid balance,
        // not a renewing cap. A vendor built for renewing caps would need
        // real handling here; Baoyun never asks for it.
        debug_assert_eq!(
            spec.reset,
            ResetPeriod::Cumulative,
            "BaoyunVendor only ever issues cumulative (prepaid) keys"
        );

        let expired_time = match &spec.expires_at {
            None => -1,
            Some(raw) => chrono::DateTime::parse_from_rfc3339(raw)
                .map(|dt| dt.timestamp())
                .map_err(|e| VendorError::Request {
                    vendor: ID,
                    message: format!("invalid expires_at `{raw}`: {e}"),
                })?,
        };

        // Whatever model list the client will be told about (env override or
        // the live cheapest-text-model lookup) is also the server-side
        // whitelist — one resolution, so the two can never drift apart.
        // Paid keys (`unrestricted_models`) are minted without a whitelist:
        // the whole catalog is callable and spend meters against the key's
        // balance. The resolution still runs so the client hint list keeps
        // its free-tier default.
        let trial_models = self.resolve_trial_models().await?;
        let body = CreateKeyBody {
            name: spec.label,
            currency: CURRENCY,
            remain: spec.limit_usd,
            unlimited: false,
            expired_time: Some(expired_time),
            model_limits_enabled: !spec.unrestricted_models,
            model_limits: if spec.unrestricted_models {
                Vec::new()
            } else {
                trial_models.clone()
            },
        };

        let resp: CreateKeyResponse = self
            .request(
                self.http
                    .post(format!("{}/api-keys", self.account_api_base))
                    .json(&body),
            )
            .await?;

        Ok(IssuedKey {
            secret: resp.key,
            handle: resp.id,
            models: trial_models,
        })
    }

    async fn read_usage(&self, handle: &str) -> Result<KeyUsage, VendorError> {
        let detail: KeyDetail = self
            .request(self.http.get(format!(
                "{}/api-keys/{handle}?currency={CURRENCY}",
                self.account_api_base
            )))
            .await?;
        Ok(detail.into())
    }

    /// Sets `remain` — the currently-spendable balance — to the given
    /// absolute value. Baoyun has no separate "lifetime total cap" the way
    /// OpenRouter does; `remain` is the only cap concept a prepaid wallet has,
    /// so that is what this sets. Prefer [`Self::top_up`] for an actual
    /// top-up: it is atomic against concurrent spend, this is not.
    ///
    /// Per Baoyun's docs: a key that is expired or already exhausted (status
    /// 3/4) will not resume serving from `remain` alone — it also needs
    /// `status: 1`. This call does not set that; a caller reviving a dead key
    /// must send both fields (extend `PatchRemainBody` when that lands).
    async fn set_limit(&self, handle: &str, limit_usd: f64) -> Result<(), VendorError> {
        let _: KeyDetail = self
            .request(
                self.http
                    .patch(format!("{}/api-keys/{handle}", self.account_api_base))
                    .json(&PatchRemainBody {
                        currency: CURRENCY,
                        remain: limit_usd,
                    }),
            )
            .await?;
        Ok(())
    }

    /// Atomically adds `delta_usd` to `remain` via Baoyun's `remain_delta` —
    /// the field its own docs recommend specifically for top-up, "to avoid a
    /// GET-then-SET race with concurrent spend." One PATCH, no separate read.
    async fn top_up(&self, handle: &str, delta_usd: f64) -> Result<KeyUsage, VendorError> {
        let detail: KeyDetail = self
            .request(
                self.http
                    .patch(format!("{}/api-keys/{handle}", self.account_api_base))
                    .json(&PatchRemainDeltaBody {
                        currency: CURRENCY,
                        remain_delta: delta_usd,
                    }),
            )
            .await?;
        Ok(detail.into())
    }

    async fn set_model_limits(&self, handle: &str, unrestricted: bool) -> Result<(), VendorError> {
        let _: KeyDetail = self
            .request(
                self.http
                    .patch(format!("{}/api-keys/{handle}", self.account_api_base))
                    .json(&PatchModelsBody {
                        currency: CURRENCY,
                        model_limits_enabled: !unrestricted,
                        model_limits: Vec::new(),
                    }),
            )
            .await?;
        Ok(())
    }

    async fn revoke(&self, handle: &str) -> Result<(), VendorError> {
        let resp = self
            .http
            .delete(format!("{}/api-keys/{handle}", self.account_api_base))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| VendorError::Request {
                vendor: ID,
                message: e.to_string(),
            })?;

        if resp.status().is_success() {
            Ok(())
        } else {
            Err(VendorError::Upstream {
                vendor: ID,
                status: resp.status().as_u16(),
                body: resp.text().await.unwrap_or_default(),
            })
        }
    }

    async fn create_topup_order(&self, spec: TopupOrderSpec) -> Result<TopupOrder, VendorError> {
        let body = CreateTopupOrderBody {
            method: "online",
            amount: spec.amount,
            reference: Some(spec.reference),
            idempotency_key: Some(spec.idempotency_key),
        };
        let resp: TopupOrderResponseBody = self
            .request(
                self.http
                    .post(format!("{}/topup/orders", self.account_api_base))
                    .json(&body),
            )
            .await?;
        resp.try_into()
    }

    async fn get_topup_order(&self, order_id: &str) -> Result<TopupOrder, VendorError> {
        let resp: TopupOrderResponseBody = self
            .request(
                self.http
                    .get(format!("{}/topup/orders/{order_id}", self.account_api_base)),
            )
            .await?;
        resp.try_into()
    }

    /// `request()` only distinguishes success/failure; a 404 here is a third,
    /// expected outcome (the key is genuinely gone), so this talks to reqwest
    /// directly rather than growing `request()` a third state that every
    /// other call site would have to keep ignoring.
    async fn key_alive_models(&self, handle: &str) -> Result<Option<Vec<String>>, VendorError> {
        let resp = self
            .http
            .get(format!(
                "{}/api-keys/{handle}?currency={CURRENCY}",
                self.account_api_base
            ))
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| VendorError::Request {
                vendor: ID,
                message: e.to_string(),
            })?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let status = resp.status();
        if !status.is_success() {
            return Err(VendorError::Upstream {
                vendor: ID,
                status: status.as_u16(),
                body: resp.text().await.unwrap_or_default(),
            });
        }

        let detail: KeyDetail = resp.json().await.map_err(|e| VendorError::Request {
            vendor: ID,
            message: e.to_string(),
        })?;
        Ok(Some(detail.model_limits))
    }

    async fn reveal_key(&self, handle: &str) -> Result<String, VendorError> {
        let resp: RevealKeyResponse = self
            .request(
                self.http
                    .post(format!("{}/api-keys/{handle}/key", self.account_api_base))
                    .json(&RevealKeyBody {}),
            )
            .await?;
        Ok(resp.key)
    }

    async fn paid_total(&self, reference: &str) -> Result<f64, VendorError> {
        let mut total = 0.0;
        let mut page: u32 = 1;
        loop {
            let resp: TopupOrderListResponseBody = self
                .request(
                    self.http
                        .get(format!("{}/topup/orders", self.account_api_base))
                        .query(&[
                            ("reference", reference),
                            ("status", "success"),
                            ("page", &page.to_string()),
                            ("page_size", "100"),
                        ]),
                )
                .await?;
            total += sum_successful_topups(&resp.data);
            if !resp.has_more {
                break;
            }
            page += 1;
        }
        Ok(total)
    }

    async fn usage_logs(
        &self,
        handle: &str,
        since_ms: Option<i64>,
    ) -> Result<Vec<UsageLogEntry>, VendorError> {
        // Bounds how far this pages for one call — 20 pages * 100/page =
        // 2000 entries, protecting against an unbounded pull against an
        // account with very high overall log volume.
        const MAX_PAGES: u32 = 20;
        // `0` (epoch) when unset — equivalent to no lower bound, and lets
        // every page use the same query shape rather than conditionally
        // adding the param.
        let start_timestamp = since_ms.map(|ms| ms / 1000).unwrap_or(0).to_string();
        let mut out = Vec::new();
        let mut page: u32 = 1;
        loop {
            let resp: LogListResponseBody = self
                .request(
                    self.http
                        .get(format!("{}/logs", self.account_api_base))
                        .query(&[
                            ("currency", CURRENCY),
                            ("page", &page.to_string()),
                            ("page_size", "100"),
                            ("start_timestamp", &start_timestamp),
                        ]),
                )
                .await?;
            out.extend(filter_logs_for_handle(resp.data, handle)?);
            if !resp.has_more || page >= MAX_PAGES {
                break;
            }
            page += 1;
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_capped_key_reports_limit_as_remain_plus_used() {
        let usage: KeyUsage = KeyDetail {
            status: 1,
            remain: 4.0,
            used: 6.0,
            unlimited: false,
            model_limits: vec![],
        }
        .into();
        assert_eq!(usage.limit_usd, Some(10.0));
        assert_eq!(usage.remaining_usd, Some(4.0));
        assert_eq!(usage.used_usd, 6.0);
        assert_eq!(usage.currency, "CNY");
        assert_eq!(usage.reset, Some(ResetPeriod::Cumulative));
        assert!(!usage.disabled);
    }

    #[test]
    fn an_unlimited_key_reports_no_cap() {
        let usage: KeyUsage = KeyDetail {
            status: 1,
            remain: 0.0,
            used: 6.0,
            unlimited: true,
            model_limits: vec![],
        }
        .into();
        assert_eq!(usage.limit_usd, None);
        assert_eq!(usage.remaining_usd, None);
    }

    #[test]
    fn any_non_enabled_status_reads_as_disabled() {
        for status in [2, 3, 4] {
            let usage: KeyUsage = KeyDetail {
                status,
                remain: 5.0,
                used: 0.0,
                unlimited: false,
                model_limits: vec![],
            }
            .into();
            assert!(usage.disabled, "status {status} should read as disabled");
        }
    }

    fn model(id: &str, tags: &[&str]) -> ModelEntry {
        ModelEntry {
            id: id.to_string(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn price(id: &str, billing: &str, input: f64, output: f64) -> PricingEntry {
        PricingEntry {
            id: id.to_string(),
            billing: billing.to_string(),
            input,
            output,
        }
    }

    #[test]
    fn picks_the_cheapest_of_several_text_models() {
        let models = [
            model("qwen3.7-flash", &["input.text", "output.text"]),
            model("gpt-4o", &["input.text", "input.image", "output.text"]),
            model("deepseek-v4-1-flash", &["input.text", "output.text"]),
        ];
        let pricing = [
            price("qwen3.7-flash", "token", 0.20, 0.80),
            price("gpt-4o", "token", 17.5, 70.0),
            price("deepseek-v4-1-flash", "token", 1.0, 4.0),
        ];
        assert_eq!(
            pick_cheapest_text_model(&models, &pricing),
            Some("qwen3.7-flash".to_string())
        );
    }

    #[test]
    fn excludes_image_and_video_models_even_when_cheaper() {
        let models = [
            // Cheaper on paper, but it doesn't produce text — must not win.
            model("gpt-image-2.5-flare", &["input.text", "output.image"]),
            model("qwen3.7-flash", &["input.text", "output.text"]),
        ];
        let pricing = [
            price("gpt-image-2.5-flare", "token", 0.01, 0.01),
            price("qwen3.7-flash", "token", 0.20, 0.80),
        ];
        assert_eq!(
            pick_cheapest_text_model(&models, &pricing),
            Some("qwen3.7-flash".to_string())
        );
    }

    #[test]
    fn a_model_with_no_matching_pricing_entry_is_skipped() {
        let models = [model("mystery-model", &["output.text"])];
        assert_eq!(pick_cheapest_text_model(&models, &[]), None);
    }

    #[test]
    fn ignores_non_token_billing_even_if_tagged_text() {
        // Shouldn't happen in practice (video/audio models don't carry
        // output.text), but the billing filter must hold regardless.
        let models = [model("per-second-thing", &["output.text"])];
        let pricing = [price("per-second-thing", "per_second", 0.5, 0.0)];
        assert_eq!(pick_cheapest_text_model(&models, &pricing), None);
    }

    #[test]
    fn no_candidates_at_all_is_none_not_a_panic() {
        assert_eq!(pick_cheapest_text_model(&[], &[]), None);
    }

    /// `issue_key` must send the trial model list as a server-side whitelist,
    /// not just leave it to the client — otherwise a trial key can be pointed
    /// at any (possibly expensive) model by hand.
    #[test]
    fn create_key_body_whitelists_the_trial_models() {
        let body = CreateKeyBody {
            name: "x".into(),
            currency: CURRENCY,
            remain: 5.0,
            unlimited: false,
            expired_time: Some(-1),
            model_limits_enabled: true,
            model_limits: vec!["qwen3.7-flash".to_string()],
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["model_limits_enabled"], true);
        assert_eq!(json["model_limits"], serde_json::json!(["qwen3.7-flash"]));
    }

    /// A top-up must serialize as `remain_delta`, never `remain` — sending
    /// the absolute-set field here would silently turn "add ¥20" into
    /// "set balance to ¥20", wiping out whatever the user had left.
    #[test]
    fn top_up_serializes_as_remain_delta_not_remain() {
        let body = PatchRemainDeltaBody {
            currency: CURRENCY,
            remain_delta: 20.0,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["remain_delta"], 20.0);
        assert!(json.get("remain").is_none(), "must not send remain: {json}");
    }

    #[test]
    fn model_tier_patch_serializes_without_the_stale_list_when_unlocking() {
        // Unlock sends only the flag: verified live, `model_limits_enabled:
        // false` alone lifts the whitelist and the stale list is ignored.
        // Re-pinning (future ops use) would carry the list.
        let unlock = PatchModelsBody {
            currency: CURRENCY,
            model_limits_enabled: false,
            model_limits: vec![],
        };
        let json = serde_json::to_value(&unlock).unwrap();
        assert_eq!(json["model_limits_enabled"], false);
        assert!(
            json.get("model_limits").is_none(),
            "empty list must be omitted: {json}"
        );

        let pin = PatchModelsBody {
            currency: CURRENCY,
            model_limits_enabled: true,
            model_limits: vec!["qwen3.7-flash".to_string()],
        };
        let json = serde_json::to_value(&pin).unwrap();
        assert_eq!(json["model_limits_enabled"], true);
        assert_eq!(json["model_limits"], serde_json::json!(["qwen3.7-flash"]));
    }

    #[test]
    fn issuing_with_a_non_cumulative_reset_is_rejected_by_debug_assert() {
        // Guards the assumption documented on `issue_key`: this vendor is
        // only ever wired up with a cumulative (prepaid) reset policy.
        let result = std::panic::catch_unwind(|| {
            let vendor = BaoyunVendor::new("token".to_string());
            let rt = tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap();
            rt.block_on(vendor.issue_key(KeySpec {
                label: "x".into(),
                limit_usd: 10.0,
                reset: ResetPeriod::Monthly,
                expires_at: None,
                unrestricted_models: false,
            }))
        });
        assert!(result.is_err(), "expected the debug_assert to panic");
    }

    #[test]
    fn create_topup_order_body_carries_reference_and_idempotency_key() {
        let body = CreateTopupOrderBody {
            method: "online",
            amount: 10.0,
            reference: Some("baoyun:install-1".to_string()),
            idempotency_key: Some("ord-1".to_string()),
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["method"], "online");
        assert_eq!(json["amount"], 10.0);
        assert_eq!(json["reference"], "baoyun:install-1");
        assert_eq!(json["idempotency_key"], "ord-1");
    }

    /// Mirrors the docs' "pending (with QR)" example.
    #[test]
    fn parses_a_pending_topup_order() {
        let body: TopupOrderResponseBody = serde_json::from_value(serde_json::json!({
            "object": "topup_order",
            "id": "BF1715367049Ab12Cd",
            "method": "online",
            "status": "pending",
            "currency": "CNY",
            "amount": 10,
            "created": 1715367049,
            "reference": "inv-1001",
            "qr_code": "https://pay.example/qr",
            "expires_at": 1715368849
        }))
        .unwrap();
        let order = TopupOrder::try_from(body).unwrap();
        assert_eq!(order.status, TopupOrderStatus::Pending);
        assert_eq!(order.qr_code.as_deref(), Some("https://pay.example/qr"));
        assert_eq!(order.reference.as_deref(), Some("inv-1001"));
        assert_eq!(order.completed_at, None);
    }

    /// Mirrors the docs' "settled" example: no `qr_code`/`expires_at`, has
    /// `completed_at`.
    #[test]
    fn parses_a_settled_topup_order() {
        let body: TopupOrderResponseBody = serde_json::from_value(serde_json::json!({
            "object": "topup_order",
            "id": "BF1715367049Ab12Cd",
            "method": "online",
            "status": "success",
            "currency": "CNY",
            "amount": 10,
            "created": 1715367049,
            "reference": "inv-1001",
            "completed_at": 1715367200
        }))
        .unwrap();
        let order = TopupOrder::try_from(body).unwrap();
        assert_eq!(order.status, TopupOrderStatus::Success);
        assert_eq!(order.qr_code, None);
        assert_eq!(order.completed_at, Some(1715367200));
    }

    #[test]
    fn an_unrecognised_status_is_a_request_error_not_a_panic() {
        let body: TopupOrderResponseBody = serde_json::from_value(serde_json::json!({
            "id": "x", "status": "something_new", "currency": "CNY", "amount": 1.0
        }))
        .unwrap();
        assert!(TopupOrder::try_from(body).is_err());
    }

    fn ord(status: &str, amount: f64) -> TopupOrderResponseBody {
        TopupOrderResponseBody {
            id: "x".to_string(),
            status: status.to_string(),
            currency: "CNY".to_string(),
            amount,
            reference: None,
            qr_code: None,
            expires_at: None,
            completed_at: None,
        }
    }

    #[test]
    fn sum_successful_topups_is_zero_for_an_empty_list() {
        assert_eq!(sum_successful_topups(&[]), 0.0);
    }

    #[test]
    fn sum_successful_topups_only_counts_success_status() {
        let orders = [
            ord("success", 10.0),
            ord("pending", 5.0),
            ord("failed", 20.0),
            ord("expired", 1.0),
            ord("success", 2.5),
        ];
        assert_eq!(sum_successful_topups(&orders), 12.5);
    }

    #[test]
    fn sum_successful_topups_across_what_would_be_several_pages() {
        // `paid_total` sums page by page as it paginates; this only checks
        // the pure arithmetic handles a page-sized batch correctly — the
        // pagination loop itself isn't exercised without a live account.
        let page: Vec<TopupOrderResponseBody> = (0..100).map(|_| ord("success", 1.0)).collect();
        assert_eq!(sum_successful_topups(&page), 100.0);
    }

    fn log(token_id: &str, log_type: i32, amount: f64) -> LogEntry {
        LogEntry {
            id: "log-x".to_string(),
            log_type,
            created: 1_700_000_000,
            model: "gpt-5.4".to_string(),
            token_id: token_id.to_string(),
            amount,
            prompt_tokens: 100,
            completion_tokens: 50,
            use_time: 1234,
            request_id: "req-x".to_string(),
            is_stream: true,
        }
    }

    #[test]
    fn filter_logs_for_handle_is_empty_for_an_empty_list() {
        assert_eq!(filter_logs_for_handle(vec![], "handle-1").unwrap(), vec![]);
    }

    #[test]
    fn filter_logs_for_handle_keeps_only_the_matching_token_id() {
        let entries = vec![
            log("handle-1", 1, 0.12),
            log("handle-2", 1, 0.50),
            log("handle-1", 2, 0.0),
        ];
        let kept = filter_logs_for_handle(entries, "handle-1").unwrap();
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().all(|e| e.amount == 0.12 || e.amount == 0.0));
    }

    #[test]
    fn filter_logs_for_handle_returns_empty_when_nothing_matches() {
        let entries = vec![log("handle-2", 1, 0.12)];
        assert_eq!(filter_logs_for_handle(entries, "handle-1").unwrap(), vec![]);
    }

    #[test]
    fn filter_logs_for_handle_maps_the_log_type_to_a_kind() {
        let entries = vec![log("h", 1, 1.0), log("h", 2, 0.0), log("h", 3, 0.5)];
        let kept = filter_logs_for_handle(entries, "h").unwrap();
        assert_eq!(
            kept.iter().map(|e| e.kind).collect::<Vec<_>>(),
            vec![
                UsageLogKind::Charge,
                UsageLogKind::Error,
                UsageLogKind::Refund
            ]
        );
    }

    #[test]
    fn filter_logs_for_handle_rejects_an_unrecognised_log_type() {
        let entries = vec![log("h", 99, 1.0)];
        assert!(filter_logs_for_handle(entries, "h").is_err());
    }
}
