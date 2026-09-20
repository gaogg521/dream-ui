//! Mode B (metered proxy) end to end: claim, the forwarding path, billing from
//! a resolver, top-up orders, and the async-cost poller.
//!
//! A tiny axum server stands in for the upstream vendor so the real
//! `build_router` handles every request — header swap, streaming, request-id
//! capture and the hard block are all exercised for real.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::Router;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::metered::gateway::MockGateway;
use dream_trial_broker::metered::{
    baoyun, poller, store, CostOutcome, CostResolver, MeteredError, MeteredRuntime,
    MeteredVendorConfig, Package, PaymentGateway, ProxiedCall,
};
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::routes::build_router;
use dream_trial_broker::service::AppState;
use dream_trial_broker::vendor::openrouter::OpenRouterVendor;
use dream_trial_broker::vendor::TokenVendor;

const VENDOR: &str = baoyun::ID;
const MASTER_KEY: &str = "master-key-xyz";
const GATEWAY_SECRET: &str = "test-secret";
const MODELS: &[&str] = &["mock/model-a", "mock/model-b"];

// --- a scripted cost resolver ------------------------------------------

struct ScriptedResolver {
    outcomes: Mutex<VecDeque<Result<CostOutcome, ()>>>,
    calls: Mutex<Vec<String>>,
}

impl ScriptedResolver {
    fn new(script: impl IntoIterator<Item = Result<CostOutcome, ()>>) -> Arc<Self> {
        Arc::new(Self {
            outcomes: Mutex::new(script.into_iter().collect()),
            calls: Mutex::new(Vec::new()),
        })
    }

    fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

#[async_trait]
impl CostResolver for ScriptedResolver {
    async fn resolve(&self, call: &ProxiedCall) -> Result<CostOutcome, MeteredError> {
        self.calls.lock().unwrap().push(call.request_id.clone());
        match self.outcomes.lock().unwrap().pop_front() {
            Some(Ok(outcome)) => Ok(outcome),
            Some(Err(())) => Err(MeteredError::Other("scripted failure".into())),
            // Default once the script runs dry: keep saying "not priced yet".
            None => Ok(CostOutcome::Pending),
        }
    }
}

// --- mock upstream vendor ------------------------------------------

#[derive(Clone)]
struct UpstreamState {
    request_id: String,
    seen_auth: Arc<Mutex<Option<String>>>,
}

async fn mock_chat(
    State(st): State<UpstreamState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ([(String, String); 2], String) {
    *st.seen_auth.lock().unwrap() = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let _ = body;
    (
        [
            ("x-aihub-request-id".to_string(), st.request_id.clone()),
            ("content-type".to_string(), "application/json".to_string()),
        ],
        r#"{"choices":[{"message":{"content":"hi"}}]}"#.to_string(),
    )
}

async fn spawn_upstream(request_id: &str) -> (String, Arc<Mutex<Option<String>>>) {
    let seen_auth = Arc::new(Mutex::new(None));
    let st = UpstreamState {
        request_id: request_id.to_string(),
        seen_auth: seen_auth.clone(),
    };
    let app = Router::new()
        .route("/v1/chat/completions", post(mock_chat))
        .with_state(st);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), seen_auth)
}

// --- broker wiring ------------------------------------------------

fn base_config() -> Config {
    Config {
        openrouter_management_key: "unused".to_string(),
        baoyun: None,
        database_url: "sqlite::memory:".to_string(),
        daily_budget_usd_cap: 50.0,
        trial_key_limit_usd: 1.0,
        trial_key_limit_reset: dream_trial_broker::vendor::ResetPeriod::Monthly,
        trial_key_expires_days: 90,
        listen_addr: "127.0.0.1:0".to_string(),
        per_ip_rate_limit_per_hour: 1000,
        public_base_url: "http://broker.test".to_string(),
    }
}

struct Harness {
    state: Arc<AppState>,
    resolver: Arc<ScriptedResolver>,
}

async fn harness(
    free_grant_cents: i64,
    upstream_base_url: String,
    resolver: Arc<ScriptedResolver>,
) -> Harness {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();

    let config = MeteredVendorConfig {
        id: VENDOR,
        base_url: upstream_base_url,
        master_api_key: MASTER_KEY.to_string(),
        currency: "CNY",
        free_grant_cents,
        models: MODELS.iter().map(|s| s.to_string()).collect(),
        packages: vec![Package {
            id: "59",
            price_cents: 5_900,
            credit_cents: 5_900,
        }],
    };

    let mut configs = HashMap::new();
    configs.insert(VENDOR, config);
    let mut resolvers: HashMap<&'static str, Arc<dyn CostResolver>> = HashMap::new();
    resolvers.insert(VENDOR, resolver.clone() as Arc<dyn CostResolver>);

    let metered = Arc::new(MeteredRuntime {
        configs,
        resolvers,
        gateway: Arc::new(MockGateway::new(GATEWAY_SECRET.to_string())) as Arc<dyn PaymentGateway>,
        http: reqwest::Client::new(),
    });

    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    let openrouter_vendor: Arc<dyn TokenVendor> =
        Arc::new(OpenRouterVendor::new("unused".to_string()));
    vendors.insert(openrouter_vendor.id(), openrouter_vendor);

    let state = Arc::new(AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered,
        // Mode C is off for these tests: it shares nothing with mode B.
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    });

    Harness { state, resolver }
}

async fn serve(state: Arc<AppState>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = build_router(state);
    tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    format!("http://{addr}")
}

/// Waits up to ~5s for `consumed_cents` to reach `want`, since billing runs on
/// a spawned task with a short pre-query delay.
async fn wait_for_consumed(state: &AppState, install_id: &str, want: i64) -> i64 {
    for _ in 0..50 {
        let acct = store::get_account(&state.pool, VENDOR, install_id)
            .await
            .unwrap();
        if let Some(a) = acct {
            if a.consumed_cents >= want {
                return a.consumed_cents;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("consumed_cents never reached {want}");
}

// --- tests ----------------------------------------------------------

#[tokio::test]
async fn claim_grants_free_credit_once_then_only_rotates_the_token() {
    let (upstream, _) = spawn_upstream("rid-unused").await;
    let h = harness(1_000, upstream, ScriptedResolver::new([])).await;
    let base = serve(h.state.clone()).await;
    let http = reqwest::Client::new();

    let first: serde_json::Value = http
        .post(format!("{base}/v1/metered/claim"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-1" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(first["remaining_cents"], 1_000);
    assert_eq!(first["free_grant_cents"], 1_000);
    assert_eq!(
        first["base_url"],
        "http://broker.test/v1/metered/proxy/baoyun"
    );
    let token_1 = first["device_token"].as_str().unwrap().to_string();

    let second: serde_json::Value = http
        .post(format!("{base}/v1/metered/claim"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-1" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Reinstalling must not re-mint free credit.
    assert_eq!(second["remaining_cents"], 1_000);
    assert_ne!(second["device_token"].as_str().unwrap(), token_1);

    // Only the old token stops working.
    let acct = store::find_account_by_token(&h.state.pool, VENDOR, &sha256_hex(&token_1))
        .await
        .unwrap();
    assert!(acct.is_none(), "old token should no longer resolve");
}

#[tokio::test]
async fn proxy_hard_blocks_at_zero_balance() {
    let (upstream, _) = spawn_upstream("rid-blocked").await;
    let h = harness(0, upstream, ScriptedResolver::new([])).await;
    let base = serve(h.state.clone()).await;
    let http = reqwest::Client::new();

    let claim: serde_json::Value = http
        .post(format!("{base}/v1/metered/claim"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-broke" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = claim["device_token"].as_str().unwrap();

    let resp = http
        .post(format!(
            "{base}/v1/metered/proxy/{VENDOR}/v1/chat/completions"
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({ "model": "mock/model-a" }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), reqwest::StatusCode::PAYMENT_REQUIRED);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["code"], "QUOTA_EXHAUSTED");
    assert_eq!(body["vendor"], VENDOR);
    // The upstream must not have been touched.
    assert_eq!(h.resolver.call_count(), 0);
}

#[tokio::test]
async fn proxy_swaps_the_master_key_and_bills_from_the_resolver() {
    let (upstream, seen_auth) = spawn_upstream("rid-777").await;
    let h = harness(
        1_000,
        upstream,
        ScriptedResolver::new([Ok(CostOutcome::Settled(22))]),
    )
    .await;
    let base = serve(h.state.clone()).await;
    let http = reqwest::Client::new();

    let claim: serde_json::Value = http
        .post(format!("{base}/v1/metered/claim"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-pay" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = claim["device_token"].as_str().unwrap();

    let resp = http
        .post(format!(
            "{base}/v1/metered/proxy/{VENDOR}/v1/chat/completions"
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({ "model": "mock/model-a" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["choices"][0]["message"]["content"], "hi");

    // The client's bearer was replaced by the vendor master key.
    assert_eq!(
        seen_auth.lock().unwrap().as_deref(),
        Some(format!("Bearer {MASTER_KEY}").as_str())
    );

    // Billing lands asynchronously from the resolver's figure.
    let consumed = wait_for_consumed(&h.state, "dev-pay", 22).await;
    assert_eq!(consumed, 22);

    let quota: serde_json::Value = http
        .post(format!("{base}/v1/metered/quota/status"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-pay" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(quota["remaining_cents"], 978);
    assert_eq!(quota["consumed_cents"], 22);
    assert_eq!(quota["exhausted"], false);
}

#[tokio::test]
async fn consume_is_applied_exactly_once_per_request_id() {
    let (upstream, _) = spawn_upstream("rid-dup").await;
    let h = harness(1_000, upstream, ScriptedResolver::new([])).await;
    store::claim(&h.state.pool, VENDOR, "dev-idem", "hash", 1_000, 1)
        .await
        .unwrap();

    let first = store::apply_consume(&h.state.pool, VENDOR, "dev-idem", "rid-dup", 30, 1)
        .await
        .unwrap();
    let second = store::apply_consume(&h.state.pool, VENDOR, "dev-idem", "rid-dup", 30, 2)
        .await
        .unwrap();

    assert!(first, "first write applies");
    assert!(!second, "second write for the same request id is a no-op");

    let acct = store::get_account(&h.state.pool, VENDOR, "dev-idem")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(acct.consumed_cents, 30);
}

#[tokio::test]
async fn a_paid_order_credits_the_balance_once() {
    let (upstream, _) = spawn_upstream("rid-order").await;
    let h = harness(1_000, upstream, ScriptedResolver::new([])).await;
    let base = serve(h.state.clone()).await;
    let http = reqwest::Client::new();

    http.post(format!("{base}/v1/metered/claim"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-buy" }))
        .send()
        .await
        .unwrap();

    let order: serde_json::Value = http
        .post(format!("{base}/v1/metered/orders"))
        .json(&serde_json::json!({
            "vendor": VENDOR, "install_id": "dev-buy", "package_id": "59"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(order["status"], "pending");
    assert_eq!(order["amount_cents"], 5_900);
    let order_id = order["id"].as_str().unwrap().to_string();

    let webhook_body =
        serde_json::json!({ "order_id": order_id, "paid": true, "secret": GATEWAY_SECRET });
    for _ in 0..2 {
        let resp = http
            .post(format!("{base}/v1/metered/orders/webhook/mock"))
            .json(&webhook_body)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), reqwest::StatusCode::OK);
    }

    let quota: serde_json::Value = http
        .post(format!("{base}/v1/metered/quota/status"))
        .json(&serde_json::json!({ "vendor": VENDOR, "install_id": "dev-buy" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Free grant + exactly one credit, not two.
    assert_eq!(quota["purchased_cents"], 5_900);
    assert_eq!(quota["remaining_cents"], 6_900);

    let status: serde_json::Value = http
        .get(format!("{base}/v1/metered/orders/{order_id}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["status"], "paid");
}

#[tokio::test]
async fn a_bad_webhook_secret_is_rejected() {
    let (upstream, _) = spawn_upstream("rid-x").await;
    let h = harness(1_000, upstream, ScriptedResolver::new([])).await;
    let base = serve(h.state.clone()).await;
    let http = reqwest::Client::new();

    let resp = http
        .post(format!("{base}/v1/metered/orders/webhook/mock"))
        .json(&serde_json::json!({ "order_id": "whatever", "paid": true, "secret": "wrong" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::BAD_REQUEST);
    assert_eq!(
        resp.json::<serde_json::Value>().await.unwrap()["error"],
        "webhook_rejected"
    );
}

#[tokio::test]
async fn the_poller_settles_a_pending_async_cost() {
    let (upstream, _) = spawn_upstream("rid-async").await;
    // First look: not priced yet. Second look (poller): settled.
    let resolver = ScriptedResolver::new([Ok(CostOutcome::Pending), Ok(CostOutcome::Settled(150))]);
    let h = harness(1_000, upstream, resolver).await;
    store::claim(&h.state.pool, VENDOR, "dev-async", "hash", 1_000, 1)
        .await
        .unwrap();

    // Simulate the proxy handing an unsettled request id to the queue.
    store::enqueue_pending(
        &h.state.pool,
        VENDOR,
        "dev-async",
        "rid-async",
        Some("task-async"),
        1,
        1,
    )
    .await
    .unwrap();
    // Drain the scripted "Pending" so the poller's call gets "Settled".
    let _ = h
        .resolver
        .resolve(&ProxiedCall {
            request_id: "rid-async".into(),
            task_id: None,
        })
        .await;

    poller::poll_once(&h.state).await.unwrap();

    let acct = store::get_account(&h.state.pool, VENDOR, "dev-async")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(acct.consumed_cents, 150);

    let remaining = store::due_pending(&h.state.pool, i64::MAX, 10)
        .await
        .unwrap();
    assert!(
        remaining.is_empty(),
        "settled row should be removed from the queue"
    );
}

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
