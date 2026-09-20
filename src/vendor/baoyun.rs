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

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, VendorClientConfig,
    VendorError,
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

/// Placeholder trial model, used only when `BAOYUN_TRIAL_MODELS` is unset.
///
/// **Unverified.** Same caveat as mode B carried: the real catalogue has not
/// been curated. Set `BAOYUN_TRIAL_MODELS` before promoting the offer.
const PLACEHOLDER_MODELS: &[&str] = &["deepseek-chat"];

fn trial_models_from_env() -> Vec<String> {
    match std::env::var("BAOYUN_TRIAL_MODELS") {
        Ok(v) => v
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        Err(_) => {
            tracing::warn!(
                "BAOYUN_TRIAL_MODELS unset; serving placeholder model list {:?} — curate before promoting the offer",
                PLACEHOLDER_MODELS
            );
            PLACEHOLDER_MODELS.iter().map(|s| s.to_string()).collect()
        }
    }
}

#[derive(Debug, Serialize)]
struct CreateKeyBody {
    name: String,
    currency: &'static str,
    remain: f64,
    unlimited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    expired_time: Option<i64>,
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
            models: trial_models_from_env(),
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

        let body = CreateKeyBody {
            name: spec.label,
            currency: CURRENCY,
            remain: spec.limit_usd,
            unlimited: false,
            expired_time: Some(expired_time),
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
            }
            .into();
            assert!(usage.disabled, "status {status} should read as disabled");
        }
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
            }))
        });
        assert!(result.is_err(), "expected the debug_assert to panic");
    }
}
