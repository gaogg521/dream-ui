use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::error::AppError;
use dream_trial_broker::openrouter::{
    CreateKeyData, CreateKeyRequest, CreateKeyResponse, OpenRouterClient, OpenRouterError,
};
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::service::{issue_trial_key, AppState};

/// Mock OpenRouter client: never touches the network. Configurable to
/// succeed or to simulate an upstream failure.
struct MockOpenRouter {
    should_fail: bool,
}

#[async_trait]
impl OpenRouterClient for MockOpenRouter {
    async fn create_key(
        &self,
        _req: CreateKeyRequest,
    ) -> Result<CreateKeyResponse, OpenRouterError> {
        if self.should_fail {
            return Err(OpenRouterError::Upstream {
                status: 500,
                body: "simulated upstream failure".to_string(),
            });
        }

        Ok(CreateKeyResponse {
            data: CreateKeyData {
                hash: "mock-hash".to_string(),
                label: Some("onework-trial-mock".to_string()),
                limit: Some(1.0),
                limit_remaining: Some(1.0),
                limit_reset: Some("daily".to_string()),
            },
            key: "sk-or-v1-mock-key".to_string(),
        })
    }
}

fn base_config() -> Config {
    Config {
        openrouter_management_key: "test-management-key".to_string(),
        database_url: "sqlite::memory:".to_string(),
        daily_budget_usd_cap: 50.0,
        trial_key_limit_usd: 1.0,
        trial_key_expires_days: 90,
        listen_addr: "0.0.0.0:8787".to_string(),
        per_ip_rate_limit_per_hour: 5,
    }
}

async fn make_state(should_fail: bool, daily_budget_usd_cap: f64, rate_limit: u32) -> AppState {
    let pool = db::init_pool("sqlite::memory:")
        .await
        .expect("in-memory db should initialize");

    let mut config = base_config();
    config.daily_budget_usd_cap = daily_budget_usd_cap;
    config.per_ip_rate_limit_per_hour = rate_limit;

    AppState {
        pool,
        config: Arc::new(config),
        openrouter: Arc::new(MockOpenRouter { should_fail }),
        rate_limiter: Arc::new(RateLimiter::new(rate_limit, Duration::from_secs(3600))),
    }
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

    assert_eq!(response.key, "sk-or-v1-mock-key");
    assert_eq!(response.base_url, "https://openrouter.ai/api/v1");
    assert!(!response.models.is_empty());

    let row = db::find_active_by_install_id(&state.pool, "install-fresh")
        .await
        .expect("query should succeed")
        .expect("row should have been persisted");
    assert_eq!(row.install_id, "install-fresh");
    // The plaintext key must never be stored at rest.
    assert_ne!(row.openrouter_key_hash, "sk-or-v1-mock-key");
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

#[tokio::test]
async fn openrouter_failure_surfaces_as_502_without_persisting() {
    let state = make_state(true, 50.0, 5).await;
    let caller_ip = ip(127, 0, 0, 4);

    let err = issue_trial_key(&state, "install-upstream-fail", caller_ip)
        .await
        .expect_err("simulated openrouter failure should surface as an error");

    assert!(matches!(err, AppError::UpstreamError(_)));
    assert_eq!(err.status_code(), axum::http::StatusCode::BAD_GATEWAY);

    let row = db::find_active_by_install_id(&state.pool, "install-upstream-fail")
        .await
        .expect("query should succeed");
    assert!(row.is_none(), "no row should be persisted on upstream failure");
}
