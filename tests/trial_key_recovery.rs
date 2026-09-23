//! Recovering a repeat `POST /v1/trial-keys` claim when the existing key is
//! either still alive (just re-reveal it) or genuinely gone on the vendor's
//! side (reissue, crediting back everything the install proved it paid).
//! `tests/trial_keys.rs::duplicate_install_id_returns_409` already covers
//! the unchanged-behavior case for a vendor that implements none of this
//! (`MockVendor`, standing in for OpenRouter) — not duplicated here.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::error::AppError;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::service::{issue_trial_key, AppState};
use dream_trial_broker::vendor::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, VendorClientConfig,
    VendorError,
};

const VENDOR_ID: &str = "recoverable";

/// A vendor that *does* implement the recovery trio — stands in for Baoyun
/// without touching the network. Every knob is a `Mutex` so a test can flip
/// behavior mid-flow (e.g. "the key was alive when we listed it, then got
/// deleted").
struct RecoverableVendor {
    /// `Some(models)` = key alive with this whitelist; `None` = vendor
    /// reports it gone.
    alive_models: Mutex<Option<Vec<String>>>,
    /// If set, `key_alive_models` returns this error instead of consulting
    /// `alive_models` — for the "vendor call itself failed" case.
    alive_error: Mutex<Option<&'static str>>,
    paid_total: Mutex<f64>,
    reveal_calls: Mutex<u32>,
    issue_calls: Mutex<u32>,
}

impl RecoverableVendor {
    fn alive(models: &[&str]) -> Self {
        Self {
            alive_models: Mutex::new(Some(models.iter().map(|s| s.to_string()).collect())),
            alive_error: Mutex::new(None),
            paid_total: Mutex::new(0.0),
            reveal_calls: Mutex::new(0),
            issue_calls: Mutex::new(0),
        }
    }

    fn gone(paid_total: f64) -> Self {
        Self {
            alive_models: Mutex::new(None),
            alive_error: Mutex::new(None),
            paid_total: Mutex::new(paid_total),
            reveal_calls: Mutex::new(0),
            issue_calls: Mutex::new(0),
        }
    }

    fn erroring() -> Self {
        Self {
            alive_models: Mutex::new(None),
            alive_error: Mutex::new(Some("simulated transient failure")),
            paid_total: Mutex::new(0.0),
            reveal_calls: Mutex::new(0),
            issue_calls: Mutex::new(0),
        }
    }
}

#[async_trait]
impl TokenVendor for RecoverableVendor {
    fn id(&self) -> &'static str {
        VENDOR_ID
    }

    fn provisioning_mode(&self) -> ProvisioningMode {
        ProvisioningMode::IssuedKey
    }

    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: "MockBaoyun",
            base_url: "https://mock.example/v1",
            currency: "CNY",
        }
    }

    async fn issue_key(&self, spec: KeySpec) -> Result<IssuedKey, VendorError> {
        // Recovery must always ask for a non-negative cap.
        assert!(spec.limit_usd >= 0.0);
        let mut calls = self.issue_calls.lock().unwrap();
        *calls += 1;
        Ok(IssuedKey {
            secret: format!("sk-recovered-{calls}"),
            handle: format!("handle-{calls}"),
            models: vec!["qwen3.7-flash".to_string()],
        })
    }

    async fn read_usage(&self, _handle: &str) -> Result<KeyUsage, VendorError> {
        unreachable!("recovery does not read usage")
    }

    async fn set_limit(&self, _handle: &str, _limit_usd: f64) -> Result<(), VendorError> {
        unreachable!("recovery does not set_limit")
    }

    async fn revoke(&self, _handle: &str) -> Result<(), VendorError> {
        unreachable!("recovery does not revoke")
    }

    async fn key_alive_models(&self, _handle: &str) -> Result<Option<Vec<String>>, VendorError> {
        if let Some(message) = *self.alive_error.lock().unwrap() {
            return Err(VendorError::Upstream {
                vendor: VENDOR_ID,
                status: 500,
                body: message.to_string(),
            });
        }
        Ok(self.alive_models.lock().unwrap().clone())
    }

    async fn reveal_key(&self, handle: &str) -> Result<String, VendorError> {
        *self.reveal_calls.lock().unwrap() += 1;
        Ok(format!("sk-revealed-{handle}"))
    }

    async fn paid_total(&self, _reference: &str) -> Result<f64, VendorError> {
        Ok(*self.paid_total.lock().unwrap())
    }
}

fn base_config() -> Config {
    Config {
        openrouter_management_key: "test-management-key".to_string(),
        baoyun: None,
        database_url: "sqlite::memory:".to_string(),
        daily_budget_usd_cap: 50.0,
        trial_key_limit_usd: 5.0,
        trial_key_limit_reset: ResetPeriod::Monthly,
        trial_key_expires_days: 90,
        listen_addr: "0.0.0.0:8787".to_string(),
        per_ip_rate_limit_per_hour: 5,
        public_base_url: "http://127.0.0.1:8787".to_string(),
    }
}

async fn make_state(vendor: RecoverableVendor) -> AppState {
    let pool = db::init_pool("sqlite::memory:")
        .await
        .expect("in-memory db should initialize");
    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    vendors.insert(VENDOR_ID, Arc::new(vendor));
    AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    }
}

fn ip() -> IpAddr {
    IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))
}

/// All rows for this install regardless of `disabled`, oldest first — the
/// existing `db::find_active_by_install_id` only ever sees the live one, so
/// recovery bookkeeping needs a direct query.
async fn all_issuance_handles(state: &AppState, install_id: &str) -> Vec<(String, i64)> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT vendor_key_handle, disabled FROM issuances WHERE install_id = ? ORDER BY issued_at",
    )
    .bind(install_id)
    .fetch_all(&state.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn a_repeat_claim_with_a_still_alive_key_reveals_it_again_without_reissuing() {
    let state = make_state(RecoverableVendor::alive(&["qwen3.7-flash"])).await;
    issue_trial_key(&state, VENDOR_ID, "install-1", ip())
        .await
        .expect("first claim should succeed");

    let second = issue_trial_key(&state, VENDOR_ID, "install-1", ip())
        .await
        .expect("repeat claim on a still-alive key should recover, not 409");

    assert!(second.key.starts_with("sk-revealed-"));
    assert_eq!(second.models, vec!["qwen3.7-flash".to_string()]);

    let rows = all_issuance_handles(&state, "install-1").await;
    assert_eq!(
        rows.len(),
        1,
        "no new issuance row should have been created"
    );
    assert_eq!(rows[0].1, 0, "the original row must still be active");
}

#[tokio::test]
async fn a_repeat_claim_with_a_deleted_key_reissues_and_credits_back_what_was_paid() {
    let vendor = RecoverableVendor::gone(12.5);
    let state = make_state(vendor).await;
    issue_trial_key(&state, VENDOR_ID, "install-2", ip())
        .await
        .expect("first claim should succeed");

    let original_rows = all_issuance_handles(&state, "install-2").await;
    assert_eq!(original_rows.len(), 1);
    let original_handle = original_rows[0].0.clone();

    let recovered = issue_trial_key(&state, VENDOR_ID, "install-2", ip())
        .await
        .expect("repeat claim on a deleted key should recover by reissuing");

    assert!(recovered.key.starts_with("sk-recovered-"));

    // `issuances` is UNIQUE on (vendor, install_id) — recovery must update
    // the one existing row in place, never insert a second one.
    let rows = all_issuance_handles(&state, "install-2").await;
    assert_eq!(rows.len(), 1, "recovery must not create a second row");
    assert_eq!(rows[0].1, 0, "the row must still be active");
    assert_ne!(
        rows[0].0, original_handle,
        "recovery must point the row at the newly issued key's handle"
    );
}

#[tokio::test]
async fn a_transient_failure_checking_key_status_is_not_treated_as_gone() {
    let state = make_state(RecoverableVendor::erroring()).await;
    // Seed an issuance directly — this test only cares about the *second*
    // call's behavior when the alive-check itself fails.
    issue_trial_key(&state, VENDOR_ID, "install-3", ip())
        .await
        .expect("first claim should succeed");

    let err = issue_trial_key(&state, VENDOR_ID, "install-3", ip())
        .await
        .expect_err("a failed status check must not be treated as 'key confirmed gone'");
    assert!(matches!(err, AppError::UpstreamError(_)));

    let rows = all_issuance_handles(&state, "install-3").await;
    assert_eq!(
        rows.len(),
        1,
        "nothing should have been reissued on an inconclusive check"
    );
    assert_eq!(rows[0].1, 0);
}
