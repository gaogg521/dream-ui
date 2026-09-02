use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::error::AppError;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::service::{issue_trial_key, read_quota_status, AppState};
use dream_trial_broker::vendor::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, VendorClientConfig,
    VendorError,
};

const MODELS: &[&str] = &["vendor/free", "vendor/paid"];

/// A stand-in vendor: never touches the network, records what it was asked
/// for, and can be told to fail or to report a particular spend position.
struct MockVendor {
    should_fail: bool,
    mode: ProvisioningMode,
    /// Last spec handed to `issue_key`, so tests can assert on the cap we
    /// actually asked the vendor to enforce.
    last_spec: Mutex<Option<KeySpec>>,
    usage: Mutex<KeyUsage>,
}

impl MockVendor {
    fn new(should_fail: bool) -> Self {
        Self {
            should_fail,
            mode: ProvisioningMode::IssuedKey,
            last_spec: Mutex::new(None),
            usage: Mutex::new(KeyUsage {
                limit_usd: Some(1.0),
                used_usd: 0.25,
                remaining_usd: Some(0.75),
                reset: Some(ResetPeriod::Monthly),
                disabled: false,
            }),
        }
    }

    fn with_mode(mode: ProvisioningMode) -> Self {
        Self {
            mode,
            ..Self::new(false)
        }
    }

    fn last_spec(&self) -> KeySpec {
        self.last_spec
            .lock()
            .unwrap()
            .clone()
            .expect("the vendor should have been asked to issue a key")
    }
}

#[async_trait]
impl TokenVendor for MockVendor {
    fn id(&self) -> &'static str {
        "mockvendor"
    }

    fn provisioning_mode(&self) -> ProvisioningMode {
        self.mode
    }

    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: "MockPlatform",
            base_url: "https://mock.example/v1",
            models: MODELS,
        }
    }

    async fn issue_key(&self, spec: KeySpec) -> Result<IssuedKey, VendorError> {
        *self.last_spec.lock().unwrap() = Some(spec);
        if self.should_fail {
            return Err(VendorError::Upstream {
                vendor: "mockvendor",
                status: 500,
                body: "simulated upstream failure".to_string(),
            });
        }
        Ok(IssuedKey {
            secret: "sk-mock-key".to_string(),
            handle: "mock-handle".to_string(),
        })
    }

    async fn read_usage(&self, _handle: &str) -> Result<KeyUsage, VendorError> {
        if self.should_fail {
            return Err(VendorError::Request {
                vendor: "mockvendor",
                message: "simulated read failure".to_string(),
            });
        }
        Ok(self.usage.lock().unwrap().clone())
    }

    async fn set_limit(&self, _handle: &str, _limit_usd: f64) -> Result<(), VendorError> {
        Ok(())
    }

    async fn revoke(&self, _handle: &str) -> Result<(), VendorError> {
        Ok(())
    }
}

fn base_config() -> Config {
    Config {
        openrouter_management_key: "test-management-key".to_string(),
        database_url: "sqlite::memory:".to_string(),
        daily_budget_usd_cap: 50.0,
        trial_key_limit_usd: 1.0,
        trial_key_limit_reset: ResetPeriod::Monthly,
        trial_key_expires_days: 90,
        listen_addr: "0.0.0.0:8787".to_string(),
        per_ip_rate_limit_per_hour: 5,
        public_base_url: "http://127.0.0.1:8787".to_string(),
    }
}

async fn make_state(should_fail: bool, daily_budget_usd_cap: f64, rate_limit: u32) -> AppState {
    let (state, _) = make_state_with(MockVendor::new(should_fail), |config| {
        config.daily_budget_usd_cap = daily_budget_usd_cap;
        config.per_ip_rate_limit_per_hour = rate_limit;
    })
    .await;
    state
}

/// Builds state around a specific vendor, handing it back so the test can
/// inspect what the service actually asked of it.
async fn make_state_with(
    vendor: MockVendor,
    tweak: impl FnOnce(&mut Config),
) -> (AppState, Arc<MockVendor>) {
    let pool = db::init_pool("sqlite::memory:")
        .await
        .expect("in-memory db should initialize");

    let mut config = base_config();
    tweak(&mut config);
    let rate_limit = config.per_ip_rate_limit_per_hour;
    let vendor = Arc::new(vendor);

    let state = AppState {
        pool,
        config: Arc::new(config),
        vendor: vendor.clone(),
        rate_limiter: Arc::new(RateLimiter::new(rate_limit, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
    };
    (state, vendor)
}

fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
    IpAddr::V4(Ipv4Addr::new(a, b, c, d))
}

#[tokio::test]
async fn fresh_install_id_succeeds_and_persists_a_row() {
    let state = make_state(false, 50.0, 5).await;

    let response = issue_trial_key(&state, "install-fresh", ip(127, 0, 0, 1))
        .await
        .expect("first issuance should succeed");

    assert_eq!(response.key, "sk-mock-key");
    assert_eq!(response.base_url, "https://mock.example/v1");
    assert_eq!(response.platform, "MockPlatform");
    assert_eq!(response.vendor, "mockvendor");
    assert_eq!(response.models, MODELS);

    let row = db::find_active_by_install_id(&state.pool, "mockvendor", "install-fresh")
        .await
        .expect("query should succeed")
        .expect("row should have been persisted");
    assert_eq!(row.install_id, "install-fresh");
    assert_eq!(row.vendor, "mockvendor");
    // The plaintext key must never be stored at rest — only the vendor's
    // handle for it.
    assert_eq!(row.vendor_key_handle, "mock-handle");
    assert_ne!(row.vendor_key_handle, "sk-mock-key");
}

/// The client needs to be told which platform to create the provider as.
/// Without this it has to hardcode one vendor's name, which is exactly what
/// the abstraction exists to remove.
#[tokio::test]
async fn the_response_names_the_platform_so_the_client_need_not_hardcode_it() {
    let state = make_state(false, 50.0, 5).await;
    let response = issue_trial_key(&state, "install-platform", ip(127, 0, 0, 1))
        .await
        .unwrap();

    assert_eq!(response.platform, state.vendor.client_config().platform);
    assert_eq!(response.base_url, state.vendor.client_config().base_url);
}

#[tokio::test]
async fn duplicate_install_id_returns_409() {
    let state = make_state(false, 50.0, 5).await;
    let caller_ip = ip(127, 0, 0, 1);

    issue_trial_key(&state, "install-dup", caller_ip)
        .await
        .expect("first issuance should succeed");

    let err = issue_trial_key(&state, "install-dup", caller_ip)
        .await
        .expect_err("second issuance for same install_id should fail");

    assert!(matches!(err, AppError::AlreadyIssued));
    assert_eq!(err.status_code(), axum::http::StatusCode::CONFLICT);
}

#[tokio::test]
async fn exceeding_per_ip_rate_limit_returns_429() {
    let state = make_state(false, 50.0, 2).await;
    let caller_ip = ip(127, 0, 0, 2);

    issue_trial_key(&state, "install-rl-1", caller_ip)
        .await
        .expect("first request within limit should succeed");
    issue_trial_key(&state, "install-rl-2", caller_ip)
        .await
        .expect("second request within limit should succeed");

    let err = issue_trial_key(&state, "install-rl-3", caller_ip)
        .await
        .expect_err("third request should exceed the per-IP rate limit");

    assert!(matches!(err, AppError::RateLimited));
    assert_eq!(err.status_code(), axum::http::StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn daily_budget_cap_returns_503() {
    // cap = 2.0 USD, per-key limit = 1.0 USD -> the 3rd issuance trips it.
    let state = make_state(false, 2.0, 100).await;
    let caller_ip = ip(127, 0, 0, 3);

    issue_trial_key(&state, "install-budget-1", caller_ip)
        .await
        .expect("first issuance should succeed");
    issue_trial_key(&state, "install-budget-2", caller_ip)
        .await
        .expect("second issuance should succeed");

    let err = issue_trial_key(&state, "install-budget-3", caller_ip)
        .await
        .expect_err("third issuance should trip the daily circuit breaker");

    assert!(matches!(err, AppError::BudgetExhausted));
    assert_eq!(
        err.status_code(),
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    );
}

/// The spend cap is the whole safety story of this service, and it is a plain
/// value handed to a third party — nothing else in the system would notice if
/// it silently became daily (30x the intended monthly commitment per user) or
/// went missing entirely. So assert on the exact spec we send.
#[tokio::test]
async fn issued_keys_carry_the_configured_monthly_spend_cap() {
    let (state, vendor) = make_state_with(MockVendor::new(false), |_| {}).await;

    issue_trial_key(&state, "install-cap", ip(127, 0, 0, 9))
        .await
        .expect("issuance should succeed");

    let spec = vendor.last_spec();
    assert_eq!(spec.limit_usd, 1.0, "per-key spend cap");
    assert_eq!(
        spec.reset,
        ResetPeriod::Monthly,
        "cap must renew monthly, not daily"
    );
    assert!(spec.label.starts_with("onework-trial-"));
    assert!(
        spec.expires_at.is_some(),
        "keys must always carry an expiry"
    );
}

#[tokio::test]
async fn limit_reset_is_configurable_for_deployments_that_want_daily() {
    let (state, vendor) = make_state_with(MockVendor::new(false), |config| {
        config.trial_key_limit_reset = ResetPeriod::Daily;
    })
    .await;

    issue_trial_key(&state, "install-daily", ip(127, 0, 0, 10))
        .await
        .expect("issuance should succeed");

    assert_eq!(vendor.last_spec().reset, ResetPeriod::Daily);
}

/// A vendor that cannot cap a key must be refused *before* anything is spent.
/// Issuing an uncapped key would be worse than issuing none at all.
#[tokio::test]
async fn a_vendor_that_cannot_cap_a_key_is_refused_before_issuing() {
    let (state, vendor) = make_state_with(
        MockVendor::with_mode(ProvisioningMode::MeteredProxy),
        |_| {},
    )
    .await;

    let err = issue_trial_key(&state, "install-uncappable", ip(127, 0, 0, 11))
        .await
        .expect_err("a vendor without capped keys must not be used to issue one");

    assert!(matches!(err, AppError::Internal(_)));
    assert!(
        vendor.last_spec.lock().unwrap().is_none(),
        "the vendor must not be called at all"
    );
}

#[tokio::test]
async fn vendor_failure_surfaces_as_502_without_persisting() {
    let state = make_state(true, 50.0, 5).await;
    let caller_ip = ip(127, 0, 0, 4);

    let err = issue_trial_key(&state, "install-upstream-fail", caller_ip)
        .await
        .expect_err("simulated vendor failure should surface as an error");

    assert!(matches!(err, AppError::UpstreamError(_)));
    assert_eq!(err.status_code(), axum::http::StatusCode::BAD_GATEWAY);

    let row = db::find_active_by_install_id(&state.pool, "mockvendor", "install-upstream-fail")
        .await
        .expect("query should succeed");
    assert!(
        row.is_none(),
        "no row should be persisted on upstream failure"
    );
}

#[tokio::test]
async fn quota_status_reports_the_vendors_spend_position() {
    let state = make_state(false, 50.0, 5).await;
    issue_trial_key(&state, "install-quota", ip(127, 0, 0, 5))
        .await
        .expect("issuance should succeed");

    let status = read_quota_status(&state, "install-quota")
        .await
        .expect("quota should be readable for an issued install");

    assert_eq!(status.vendor, "mockvendor");
    assert_eq!(status.limit_usd, Some(1.0));
    assert_eq!(status.used_usd, 0.25);
    assert_eq!(status.remaining_usd, Some(0.75));
    assert_eq!(status.reset.as_deref(), Some("monthly"));
    assert!(!status.exhausted);
}

#[tokio::test]
async fn quota_status_reports_exhaustion_once_nothing_remains() {
    let (state, vendor) = make_state_with(MockVendor::new(false), |_| {}).await;
    issue_trial_key(&state, "install-spent", ip(127, 0, 0, 6))
        .await
        .unwrap();

    *vendor.usage.lock().unwrap() = KeyUsage {
        limit_usd: Some(1.0),
        used_usd: 1.0,
        remaining_usd: Some(0.0),
        reset: Some(ResetPeriod::Monthly),
        disabled: false,
    };

    let status = read_quota_status(&state, "install-spent").await.unwrap();
    assert!(status.exhausted);
    assert_eq!(status.remaining_usd, Some(0.0));
}

/// Asking about an install that never claimed a key is a 404, not an error —
/// it is the honest answer, and the client uses it to know there is nothing
/// to show rather than that something broke.
#[tokio::test]
async fn quota_status_for_an_unknown_install_is_404() {
    let state = make_state(false, 50.0, 5).await;

    let err = read_quota_status(&state, "install-never-claimed")
        .await
        .expect_err("an install with no key has no quota to report");

    assert!(matches!(err, AppError::NotIssued));
    assert_eq!(err.status_code(), axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn quota_status_rejects_an_empty_install_id() {
    let state = make_state(false, 50.0, 5).await;
    let err = read_quota_status(&state, "   ")
        .await
        .expect_err("empty id is a bad request");
    assert!(matches!(err, AppError::BadRequest(_)));
}
