//! OpenRouter as a [`TokenVendor`].
//!
//! Verified against the live API (2026-08-28), not just the docs:
//!
//! - `POST /api/v1/keys` with `{name, limit, limit_reset?, expires_at?}` →
//!   `201 {data: {hash, limit, limit_reset, ...}, key: "sk-or-v1-..."}`.
//!   The plaintext `key` appears here and nowhere else, ever.
//! - **Omitting `limit_reset` yields `limit_reset: null`** — a cumulative cap
//!   that never renews. That is the shape prepaid credit needs, and it also
//!   sidesteps the trap in the renewing form: `monthly` is a calendar reset
//!   that knows nothing about payment, so a subscription built on it keeps
//!   topping the user back up after they stop paying unless something
//!   actively patches the key down.
//! - `GET /api/v1/keys/{hash}` reads usage; `PATCH` the same path changes the
//!   limit; `DELETE` revokes. All addressed by **hash**, which is what lets
//!   this service manage keys it never stored the plaintext of.
//! - An exhausted key answers inference with **403** and a message naming the
//!   workspace URL and the key's hash — operator-internal, never to be shown
//!   to an end user.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, VendorClientConfig,
    VendorError,
};

pub const ID: &str = "openrouter";
pub const BASE_URL: &str = "https://openrouter.ai/api/v1";
/// The client-side provider platform this vendor maps to.
pub const PLATFORM: &str = "OpenRouter";

/// Curated trial models, in the order the client should offer them — **the
/// first is what it selects**.
///
/// Free-first is a promotion-phase product call. Know what it costs:
/// `openrouter/free` is $0, so it spends none of the key's allowance, and a
/// user who stays on it never reaches the cap and never sees a top-up prompt.
/// What constrains them instead is OpenRouter's free-tier *request* quota,
/// which is metered per account **globally** and therefore shared across every
/// trial user at once. Reordering this list is the whole change needed to make
/// the allowance the binding constraint again.
///
/// `openrouter/auto` is deliberately absent. Measured over three prompts it
/// cost 5-8x `auto-beta` for the same work — it injects ~85 tokens of routing
/// preamble into every request (billed input was 97/103/100 tokens for
/// 12/18/15-token prompts, while `auto-beta` billed exactly the prompt length)
/// and routes to a pricier variant. Two entries both reading "Auto Router"
/// would also just confuse someone picking a model for the first time.
///
/// The leading `~` on the DeepSeek slug is part of the real identifier, not
/// URL decoration: `deepseek/deepseek-v4-flash-latest` without it does not
/// exist.
pub const TRIAL_MODELS: &[&str] = &[
    "openrouter/free",
    "openrouter/auto-beta",
    "~deepseek/deepseek-v4-flash-latest",
];

#[derive(Debug, Serialize)]
struct CreateKeyBody {
    name: String,
    limit: f64,
    /// Omitted for a cumulative cap — see the module docs.
    #[serde(skip_serializing_if = "Option::is_none")]
    limit_reset: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct PatchKeyBody {
    limit: f64,
}

#[derive(Debug, Deserialize)]
struct KeyData {
    hash: String,
    #[serde(default)]
    limit: Option<f64>,
    #[serde(default)]
    limit_remaining: Option<f64>,
    #[serde(default)]
    limit_reset: Option<String>,
    #[serde(default)]
    usage: Option<f64>,
    #[serde(default)]
    disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct CreateKeyResponse {
    data: KeyData,
    key: String,
}

#[derive(Debug, Deserialize)]
struct ReadKeyResponse {
    data: KeyData,
}

pub struct OpenRouterVendor {
    http: reqwest::Client,
    management_key: String,
    base_url: String,
}

impl OpenRouterVendor {
    pub fn new(management_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            management_key,
            base_url: BASE_URL.to_string(),
        }
    }

    async fn request<T: serde::de::DeserializeOwned>(
        &self,
        builder: reqwest::RequestBuilder,
    ) -> Result<T, VendorError> {
        let resp = builder
            .bearer_auth(&self.management_key)
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

impl From<KeyData> for KeyUsage {
    fn from(data: KeyData) -> Self {
        Self {
            limit_usd: data.limit,
            used_usd: data.usage.unwrap_or(0.0),
            remaining_usd: data.limit_remaining,
            // A null `limit_reset` is not missing data — it is the vendor
            // saying this cap never renews.
            reset: match data.limit_reset.as_deref() {
                None => Some(ResetPeriod::Cumulative),
                Some(raw) => ResetPeriod::parse(raw),
            },
            disabled: data.disabled.unwrap_or(false),
            currency: "USD".to_string(),
        }
    }
}

#[async_trait]
impl TokenVendor for OpenRouterVendor {
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
            currency: "USD",
        }
    }

    async fn issue_key(&self, spec: KeySpec) -> Result<IssuedKey, VendorError> {
        let body = CreateKeyBody {
            name: spec.label,
            limit: spec.limit_usd,
            limit_reset: match spec.reset {
                ResetPeriod::Monthly => Some("monthly"),
                ResetPeriod::Daily => Some("daily"),
                ResetPeriod::Cumulative => None,
            },
            expires_at: spec.expires_at,
        };

        let resp: CreateKeyResponse = self
            .request(
                self.http
                    .post(format!("{}/keys", self.base_url))
                    .json(&body),
            )
            .await?;

        Ok(IssuedKey {
            secret: resp.key,
            handle: resp.data.hash,
            models: TRIAL_MODELS.iter().map(|s| s.to_string()).collect(),
        })
    }

    async fn read_usage(&self, handle: &str) -> Result<KeyUsage, VendorError> {
        let resp: ReadKeyResponse = self
            .request(self.http.get(format!("{}/keys/{handle}", self.base_url)))
            .await?;
        Ok(resp.data.into())
    }

    async fn set_limit(&self, handle: &str, limit_usd: f64) -> Result<(), VendorError> {
        let _: ReadKeyResponse = self
            .request(
                self.http
                    .patch(format!("{}/keys/{handle}", self.base_url))
                    .json(&PatchKeyBody { limit: limit_usd }),
            )
            .await?;
        Ok(())
    }

    // OpenRouter gates models per *account*, not per key — nothing to move
    // when an install crosses the paid tier.
    async fn set_model_limits(&self, _handle: &str, _unrestricted: bool) -> Result<(), VendorError> {
        Ok(())
    }

    async fn revoke(&self, handle: &str) -> Result<(), VendorError> {
        let resp = self
            .http
            .delete(format!("{}/keys/{handle}", self.base_url))
            .bearer_auth(&self.management_key)
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

    /// A cumulative cap is expressed by *omitting* `limit_reset`, not by
    /// sending a value for it. Serialising `null` or `"cumulative"` would be
    /// rejected or, worse, silently give the key a renewing cap.
    #[test]
    fn a_cumulative_cap_omits_the_reset_field_entirely() {
        let body = CreateKeyBody {
            name: "x".into(),
            limit: 1.0,
            limit_reset: None,
            expires_at: None,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert!(
            json.get("limit_reset").is_none(),
            "a cumulative cap must omit limit_reset, got {json}"
        );
    }

    #[test]
    fn a_renewing_cap_sends_the_period() {
        let body = CreateKeyBody {
            name: "x".into(),
            limit: 1.0,
            limit_reset: Some("monthly"),
            expires_at: None,
        };
        assert_eq!(
            serde_json::to_value(&body).unwrap()["limit_reset"],
            "monthly"
        );
    }

    /// A null `limit_reset` from the vendor means "never renews", which is
    /// information, not absence. Reading it as unknown would misreport a
    /// prepaid key as having no reset policy at all.
    #[test]
    fn a_null_reset_reads_as_cumulative() {
        let usage: KeyUsage = KeyData {
            hash: "h".into(),
            limit: Some(1.0),
            limit_remaining: Some(0.4),
            limit_reset: None,
            usage: Some(0.6),
            disabled: None,
        }
        .into();
        assert_eq!(usage.currency, "USD");
        assert_eq!(usage.reset, Some(ResetPeriod::Cumulative));
        assert!(!usage.is_exhausted());
    }

    #[test]
    fn exhaustion_is_no_remaining_or_disabled() {
        let spent = KeyUsage {
            limit_usd: Some(1.0),
            used_usd: 1.0,
            remaining_usd: Some(0.0),
            reset: Some(ResetPeriod::Monthly),
            disabled: false,
            currency: "USD".to_string(),
        };
        assert!(spent.is_exhausted());

        let disabled = KeyUsage {
            disabled: true,
            remaining_usd: Some(5.0),
            ..spent.clone()
        };
        assert!(
            disabled.is_exhausted(),
            "a disabled key is unusable whatever is left"
        );

        // No cap reported at all is not exhaustion.
        let uncapped = KeyUsage {
            limit_usd: None,
            remaining_usd: None,
            disabled: false,
            ..spent
        };
        assert!(!uncapped.is_exhausted());
    }

    /// Free-first is a product decision that costs conversion; if the order
    /// changes, that should be a deliberate edit here rather than a surprise.
    #[test]
    fn the_free_router_leads_the_trial_model_list() {
        assert_eq!(TRIAL_MODELS.first(), Some(&"openrouter/free"));
        assert!(
            !TRIAL_MODELS.contains(&"openrouter/auto"),
            "openrouter/auto costs 5-8x auto-beta for the same work"
        );
        assert!(
            TRIAL_MODELS.contains(&"~deepseek/deepseek-v4-flash-latest"),
            "the leading ~ is part of the real slug"
        );
    }
}
