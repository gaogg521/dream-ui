//! Baoyun (`ai.baoyun.com`) as a metered vendor (mode B).
//!
//! **Superseded as Baoyun's actual integration.** This was written when
//! Baoyun had no capped-key API, so metering inference here in the broker was
//! the only way to bound spend. Baoyun has since added one
//! (`/apis/v1/api-keys`, 2026-09-20) and moved to mode A —
//! see `crate::vendor::baoyun`, the vendor now actually in use, and
//! `crate::metered` for why this file stays: it is mode B's reference
//! implementation, not dead code, kept for a future vendor that genuinely
//! cannot issue a capped key. It is disabled by default
//! (`BAOYUN_MASTER_API_KEY` unset) and nothing currently sets that variable
//! in any deployment.
//!
//! Verified against the live docs (2026-09-02), not guessed:
//!
//! - Prepaid balance account, `Authorization: Bearer <API_KEY>`.
//! - OpenAI-compatible inference at `POST {base}/v1/chat/completions`, plain
//!   SSE when `stream: true` — no vendor-specific parsing.
//! - Every call gets a platform request id, returned in the
//!   **`X-AiHub-Request-Id`** response header (distinct from any `request_id`
//!   in the body and from an async `task_id`).
//! - **`GET {base}/v1/billing/cost?request_id=<id>`** returns that call's
//!   official net charge (`amount`, a CNY decimal string). Async jobs answer
//!   "not settled" / "not found" until they reach a terminal state.
//!
//! That billing endpoint is why this vendor needs no local price table: the
//! [`RemoteCostResolver`] just asks Baoyun what each call cost.

use async_trait::async_trait;
use serde::Deserialize;

use super::{CostOutcome, CostResolver, MeteredError, MeteredVendorConfig, Package};

pub const ID: &str = "baoyun";
pub const DEFAULT_BASE_URL: &str = "https://ai-api.baoyun.com";
pub const CURRENCY: &str = "CNY";

/// The top-up tiers offered when the balance runs out. Credit is 1:1 with the
/// price for now; whether the larger tiers should carry a bonus is an open
/// product question (handoff doc §7).
pub const PACKAGES: &[Package] = &[
    Package {
        id: "59",
        price_cents: 5_900,
        credit_cents: 5_900,
    },
    Package {
        id: "99",
        price_cents: 9_900,
        credit_cents: 9_900,
    },
    Package {
        id: "199",
        price_cents: 19_900,
        credit_cents: 19_900,
    },
];

/// Placeholder trial model, used only when `BAOYUN_TRIAL_MODELS` is unset.
///
/// **Unverified.** Baoyun is a one-api / new-api-style relay, where
/// `deepseek-chat` is the conventional slug, but the real catalogue has not
/// been checked and there is no free tier to lead with (every call is
/// prepaid). Curating this list is a follow-up before the offer is promoted.
const PLACEHOLDER_MODELS: &[&str] = &["deepseek-chat"];

/// Builds Baoyun's config from the environment, or `None` when
/// `BAOYUN_MASTER_API_KEY` is absent (metered/baoyun stays disabled and its
/// routes 404).
pub fn config_from_env() -> anyhow::Result<Option<MeteredVendorConfig>> {
    let Ok(master_api_key) = std::env::var("BAOYUN_MASTER_API_KEY") else {
        return Ok(None);
    };
    if master_api_key.trim().is_empty() {
        anyhow::bail!("BAOYUN_MASTER_API_KEY is set but empty");
    }

    let base_url = std::env::var("BAOYUN_BASE_URL")
        .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string();

    let free_grant_cents = match std::env::var("BAOYUN_FREE_GRANT_CENTS") {
        Ok(v) => v
            .parse::<i64>()
            .map_err(|e| anyhow::anyhow!("invalid BAOYUN_FREE_GRANT_CENTS: {e}"))?,
        Err(_) => 1_000, // ¥10.00
    };
    if free_grant_cents < 0 {
        anyhow::bail!("BAOYUN_FREE_GRANT_CENTS must not be negative");
    }

    let models: Vec<String> = match std::env::var("BAOYUN_TRIAL_MODELS") {
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
    };

    Ok(Some(MeteredVendorConfig {
        id: ID,
        base_url,
        master_api_key,
        currency: CURRENCY,
        free_grant_cents,
        models,
        packages: PACKAGES.to_vec(),
    }))
}

/// Resolves a call's cost by asking Baoyun's billing endpoint for the official
/// net figure.
pub struct RemoteCostResolver {
    http: reqwest::Client,
    base_url: String,
    master_api_key: String,
}

impl RemoteCostResolver {
    pub fn new(http: reqwest::Client, config: &MeteredVendorConfig) -> Self {
        Self {
            http,
            base_url: config.base_url.clone(),
            master_api_key: config.master_api_key.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct CostEnvelope {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    message: String,
    #[serde(default)]
    data: Option<CostData>,
}

#[derive(Debug, Deserialize)]
struct CostData {
    /// CNY decimal string, e.g. `"0.220008"`. Net of any refund.
    amount: String,
}

/// A vendor message that means "come back later", not "this failed".
fn looks_unsettled(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    m.contains("not settled")
        || m.contains("not_settled")
        || m.contains("cost not found")
        || m.contains("not found")
        || m.contains("pending")
}

/// `"0.220008"` CNY -> `22` cents. Sub-cent precision is lost because the
/// ledger is integer 分; the drift is at most half a cent per call and always
/// rounds to nearest.
fn cny_string_to_cents(amount: &str) -> Result<i64, MeteredError> {
    let yuan: f64 = amount.trim().parse().map_err(|_| {
        MeteredError::Other(format!("baoyun returned unparseable amount {amount:?}"))
    })?;
    if !yuan.is_finite() || yuan < 0.0 {
        return Err(MeteredError::Other(format!(
            "baoyun returned nonsensical amount {amount:?}"
        )));
    }
    Ok((yuan * 100.0).round() as i64)
}

#[async_trait]
impl CostResolver for RemoteCostResolver {
    async fn resolve(&self, call: &super::ProxiedCall) -> Result<CostOutcome, MeteredError> {
        let resp = self
            .http
            .get(format!("{}/v1/billing/cost", self.base_url))
            .query(&[("request_id", call.request_id.as_str())])
            .bearer_auth(&self.master_api_key)
            .send()
            .await
            .map_err(|e| MeteredError::Request {
                vendor: ID,
                message: e.to_string(),
            })?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        // Baoyun may signal "not priced yet" as a non-2xx or as a 200 with
        // success:false — treat the message, not the status, as authoritative.
        let envelope: CostEnvelope = serde_json::from_str(&body).unwrap_or(CostEnvelope {
            success: false,
            message: body.clone(),
            data: None,
        });

        if envelope.success {
            let data = envelope.data.ok_or_else(|| {
                MeteredError::Other("baoyun reported success with no cost data".to_string())
            })?;
            return Ok(CostOutcome::Settled(cny_string_to_cents(&data.amount)?));
        }

        if looks_unsettled(&envelope.message) || looks_unsettled(&body) {
            return Ok(CostOutcome::Pending);
        }

        Err(MeteredError::Upstream {
            vendor: ID,
            status: status.as_u16(),
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amount_string_becomes_nearest_cent() {
        assert_eq!(cny_string_to_cents("0.220008").unwrap(), 22);
        assert_eq!(cny_string_to_cents("1").unwrap(), 100);
        assert_eq!(cny_string_to_cents("0.005").unwrap(), 1);
        assert_eq!(cny_string_to_cents("0.004").unwrap(), 0);
        assert!(cny_string_to_cents("-1").is_err());
        assert!(cny_string_to_cents("abc").is_err());
    }

    #[test]
    fn unsettled_messages_are_recognised() {
        assert!(looks_unsettled("billing not settled"));
        assert!(looks_unsettled("cost not found"));
        assert!(looks_unsettled("TASK PENDING"));
        assert!(!looks_unsettled("invalid api key"));
    }

    #[test]
    fn packages_credit_one_to_one_for_now() {
        for p in PACKAGES {
            assert_eq!(p.price_cents, p.credit_cents, "package {} is not 1:1", p.id);
        }
    }
}
