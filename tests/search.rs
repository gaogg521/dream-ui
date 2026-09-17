//! Mode C (hosted search) end to end: quota accounting, the refund on an
//! upstream failure, the global spend cap, and the off switch.
//!
//! The upstream is a scripted stand-in rather than a live Tavily call — every
//! rule worth testing here is about what the broker does *around* the search,
//! and a test that needs a real API key is a test nobody runs. The mapping of
//! a real Tavily payload is covered by the unit tests in `search::tests`,
//! against a body captured from a live 200.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::error::AppError;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::search::service::{run_search, SearchRequest};
use dream_trial_broker::search::{
    store, SearchHit, SearchLimits, SearchRuntime, Upstream, UpstreamFailure,
};
use dream_trial_broker::service::AppState;
use dream_trial_broker::vendor::openrouter::OpenRouterVendor;

const INSTALL: &str = "install-abc";

// --- a scripted upstream ------------------------------------------------

struct ScriptedUpstream {
    id: &'static str,
    monthly_cap: Option<i64>,
    outcomes: Mutex<VecDeque<Result<Vec<SearchHit>, UpstreamFailure>>>,
    queries: Mutex<Vec<String>>,
}

impl ScriptedUpstream {
    fn capped(
        id: &'static str,
        monthly_cap: Option<i64>,
        script: impl IntoIterator<Item = Result<Vec<SearchHit>, UpstreamFailure>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            id,
            monthly_cap,
            outcomes: Mutex::new(script.into_iter().collect()),
            queries: Mutex::new(Vec::new()),
        })
    }

    fn call_count(&self) -> usize {
        self.queries.lock().unwrap().len()
    }
}

/// `Box<dyn Upstream>` in the runtime, `Arc<ScriptedUpstream>` in the test, so
/// the script stays inspectable after handing it over.
struct SharedUpstream(Arc<ScriptedUpstream>);

#[async_trait]
impl Upstream for SharedUpstream {
    fn id(&self) -> &'static str {
        self.0.id
    }

    fn monthly_cap(&self) -> Option<i64> {
        self.0.monthly_cap
    }

    async fn search(&self, query: &str, _count: i64) -> Result<Vec<SearchHit>, UpstreamFailure> {
        self.0.queries.lock().unwrap().push(query.to_string());
        self.0
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Ok(vec![hit("https://fallback.test")]))
    }
}

fn hit(url: &str) -> SearchHit {
    SearchHit {
        title: "T".into(),
        url: Some(url.into()),
        snippet: "S".into(),
        published_at: None,
    }
}

// --- harness ------------------------------------------------------------

fn base_config() -> Config {
    Config {
        openrouter_management_key: "unused".to_string(),
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

fn limits(per_install: i64, global: i64) -> SearchLimits {
    SearchLimits {
        daily_limit_per_install: per_install,
        global_daily_limit: global,
        rate_limit_per_hour: 1000,
    }
}

struct Harness {
    state: Arc<AppState>,
    /// The chain, in the order the service will try it.
    upstreams: Vec<Arc<ScriptedUpstream>>,
}

impl Harness {
    /// The first (primary) provider — what most tests mean by "the upstream".
    fn upstream(&self) -> &Arc<ScriptedUpstream> {
        &self.upstreams[0]
    }
}

async fn harness(
    limits: SearchLimits,
    script: impl IntoIterator<Item = Result<Vec<SearchHit>, UpstreamFailure>>,
) -> Harness {
    harness_chain(
        limits,
        vec![("primary", None, script.into_iter().collect())],
    )
    .await
}

/// One provider's id, its monthly allowance (if any) and its scripted
/// outcomes, in the order it will return them.
type ScriptedChain = Vec<(
    &'static str,
    Option<i64>,
    Vec<Result<Vec<SearchHit>, UpstreamFailure>>,
)>;

/// A harness with a whole provider chain, for the fallback tests.
async fn harness_chain(limits: SearchLimits, chain: ScriptedChain) -> Harness {
    let pool = db::init_pool("sqlite::memory:")
        .await
        .expect("in-memory db should initialize");

    let upstreams: Vec<Arc<ScriptedUpstream>> = chain
        .into_iter()
        .map(|(id, cap, script)| ScriptedUpstream::capped(id, cap, script))
        .collect();
    let providers: Vec<Box<dyn Upstream>> = upstreams
        .iter()
        .map(|u| Box::new(SharedUpstream(u.clone())) as Box<dyn Upstream>)
        .collect();

    let state = Arc::new(AppState {
        pool,
        config: Arc::new(base_config()),
        vendor: Arc::new(OpenRouterVendor::new("unused".to_string())),
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(SearchRuntime::new(limits, providers)),
    });

    Harness { state, upstreams }
}

fn request(query: &str) -> SearchRequest {
    SearchRequest {
        install_id: INSTALL.to_string(),
        query: query.to_string(),
        count: None,
    }
}

fn ip() -> std::net::IpAddr {
    std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 1))
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

// --- tests --------------------------------------------------------------

#[tokio::test]
async fn serves_a_search_and_counts_it_against_the_daily_allowance() {
    let h = harness(
        limits(3, 100),
        [Ok(vec![hit("https://a.test/1"), hit("https://b.test/2")])],
    )
    .await;

    let response = run_search(&h.state, ip(), &request("latest news"))
        .await
        .expect("search should succeed");

    assert_eq!(response.provider, "primary");
    assert_eq!(response.results.len(), 2);
    assert_eq!(response.quota.used_today, 1);
    assert_eq!(response.quota.daily_limit, 3);
    assert_eq!(response.quota.remaining, 2);
    assert_eq!(
        h.upstream().queries.lock().unwrap().as_slice(),
        ["latest news"]
    );
}

#[tokio::test]
async fn blocks_the_install_once_its_daily_allowance_is_spent() {
    let h = harness(limits(2, 100), std::iter::empty()).await;

    for expected_used in 1..=2 {
        let response = run_search(&h.state, ip(), &request("a query"))
            .await
            .unwrap();
        assert_eq!(response.quota.used_today, expected_used);
    }

    let error = run_search(&h.state, ip(), &request("a query"))
        .await
        .expect_err("the third search is over the limit");
    assert_eq!(error.error_code(), "search_quota_exhausted");

    // The rejected attempt must not leave the counter inflated, or the very
    // next day would start already short.
    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        2
    );
    // And it must never have reached the vendor — a blocked search costs us
    // nothing.
    assert_eq!(h.upstream().call_count(), 2);
}

/// The failure mode that would otherwise be invisible: an upstream outage
/// silently eating every device's allowance, then reading as "you are out of
/// quota" long after the outage ended.
#[tokio::test]
async fn gives_the_slot_back_when_the_upstream_fails() {
    let h = harness(
        limits(2, 100),
        [
            Err(UpstreamFailure::Status {
                status: 502,
                body: "bad gateway".into(),
            }),
            Err(UpstreamFailure::Transport("connection refused".into())),
        ],
    )
    .await;

    for _ in 0..2 {
        let error = run_search(&h.state, ip(), &request("a query"))
            .await
            .expect_err("upstream failure should surface");
        assert_eq!(error.error_code(), "upstream_error");
    }

    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        0,
        "two failed searches must not have spent any allowance"
    );
}

#[tokio::test]
async fn stops_everyone_once_the_days_global_cap_is_reached() {
    let h = harness(limits(100, 2), std::iter::empty()).await;

    run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();

    // A different install, nowhere near its own allowance, is still stopped —
    // the cap is on the bill, not on the device.
    let other = SearchRequest {
        install_id: "install-other".into(),
        query: "a query".into(),
        count: None,
    };
    let error = run_search(&h.state, ip(), &other)
        .await
        .expect_err("the global cap should hold");
    assert_eq!(error.error_code(), "search_budget_exhausted");
    assert_eq!(h.upstream().call_count(), 2);
}

/// The point of a second provider: the first one is broken, the search still
/// happens, and the caller is told which vendor actually answered.
#[tokio::test]
async fn falls_through_to_the_next_provider_when_the_first_fails() {
    let h = harness_chain(
        limits(5, 100),
        vec![
            (
                "primary",
                None,
                vec![Err(UpstreamFailure::Transport("connection refused".into()))],
            ),
            ("backup", None, vec![Ok(vec![hit("https://b.test/1")])]),
        ],
    )
    .await;

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(response.provider, "backup");
    assert_eq!(response.results.len(), 1);

    // One user-visible search is one slot, however many vendors it took.
    assert_eq!(response.quota.used_today, 1);
    assert_eq!(h.upstreams[0].call_count(), 1);
    assert_eq!(h.upstreams[1].call_count(), 1);
}

/// The other half of the coverage argument: the vendors index different
/// corners of the web, so a 200 with nothing in it is a reason to ask the next
/// one rather than to give up.
#[tokio::test]
async fn falls_through_when_the_first_provider_returns_nothing() {
    let h = harness_chain(
        limits(5, 100),
        vec![
            ("primary", None, vec![Ok(Vec::new())]),
            ("backup", None, vec![Ok(vec![hit("https://b.test/1")])]),
        ],
    )
    .await;

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(response.provider, "backup");
    assert_eq!(response.results.len(), 1);
}

/// A healthy provider must never be charged for the one behind it: once the
/// first answers, the chain stops.
#[tokio::test]
async fn stops_at_the_first_provider_that_answers() {
    let h = harness_chain(
        limits(5, 100),
        vec![
            ("primary", None, vec![Ok(vec![hit("https://a.test/1")])]),
            ("backup", None, vec![Ok(vec![hit("https://b.test/1")])]),
        ],
    )
    .await;

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(response.provider, "primary");
    assert_eq!(
        h.upstreams[1].call_count(),
        0,
        "the backup must not be called"
    );
}

/// Everyone looked and nobody found anything. That is an answer, not a fault —
/// so it comes back as an empty success and the slot stays spent, rather than
/// as an error that refunds and invites a retry of a query that will keep
/// finding nothing.
#[tokio::test]
async fn an_empty_result_everywhere_is_success_not_failure() {
    let h = harness_chain(
        limits(5, 100),
        vec![
            ("primary", None, vec![Ok(Vec::new())]),
            ("backup", None, vec![Ok(Vec::new())]),
        ],
    )
    .await;

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert!(response.results.is_empty());
    assert_eq!(response.quota.used_today, 1);
    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        1,
        "a search that ran is a search that was spent"
    );
}

/// One provider found nothing, the next one broke. Nothing was found, but a
/// search did run, so the honest answer is the empty result — not an error.
#[tokio::test]
async fn prefers_an_empty_answer_over_a_later_providers_failure() {
    let h = harness_chain(
        limits(5, 100),
        vec![
            ("primary", None, vec![Ok(Vec::new())]),
            (
                "backup",
                None,
                vec![Err(UpstreamFailure::Status {
                    status: 500,
                    body: "boom".into(),
                })],
            ),
        ],
    )
    .await;

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(response.provider, "primary");
    assert!(response.results.is_empty());
}

/// Only when NO provider managed to search at all is the slot given back.
#[tokio::test]
async fn refunds_only_when_every_provider_failed() {
    let h = harness_chain(
        limits(5, 100),
        vec![
            (
                "primary",
                None,
                vec![Err(UpstreamFailure::Transport("down".into()))],
            ),
            (
                "backup",
                None,
                vec![Err(UpstreamFailure::Status {
                    status: 401,
                    body: "expired".into(),
                })],
            ),
        ],
    )
    .await;

    let error = run_search(&h.state, ip(), &request("a query"))
        .await
        .expect_err("a chain that cannot search should surface an error");
    assert_eq!(error.error_code(), "upstream_error");
    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        0
    );
}

/// The handover this chain exists for: the first provider is on a free monthly
/// allowance, and once it is spent every further search goes to the next one.
///
/// Counted here rather than waiting for the vendor to refuse. Which status code
/// means "plan exhausted" is a guess — and on a plan that bills past the free
/// tier instead of refusing, the first sign would be the invoice.
#[tokio::test]
async fn hands_over_once_the_first_providers_monthly_allowance_is_spent() {
    let h = harness_chain(
        limits(100, 1000),
        vec![("primary", Some(2), vec![]), ("backup", None, vec![])],
    )
    .await;

    for _ in 0..2 {
        let response = run_search(&h.state, ip(), &request("a query"))
            .await
            .unwrap();
        assert_eq!(response.provider, "primary");
    }

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(response.provider, "backup", "the allowance is spent");
    assert_eq!(
        h.upstreams[0].call_count(),
        2,
        "the capped provider is not called again"
    );

    // The device's own allowance is untouched by which vendor served it.
    assert_eq!(response.quota.used_today, 3);
}

/// The allowance is a MONTHLY bucket, so a new month puts the first provider
/// back in front on its own — no reset job, no manual step.
///
/// The vendor's free plan renews monthly; if the counter were cumulative the
/// chain would hand over once and never hand back, and every later month would
/// be served by the paid provider while a thousand free calls went unused.
#[tokio::test]
async fn a_new_month_returns_to_the_first_provider() {
    let h = harness_chain(
        limits(100, 1000),
        vec![("primary", Some(2), vec![]), ("backup", None, vec![])],
    )
    .await;

    // Last month was spent well past the cap.
    for _ in 0..5 {
        store::record_provider_call(&h.state.pool, "primary", "2020-01")
            .await
            .unwrap();
    }

    let response = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(
        response.provider, "primary",
        "a spent month must not follow the provider into the next one"
    );
    assert_eq!(
        store::provider_used_this_month(&h.state.pool, "primary", "2020-01")
            .await
            .unwrap(),
        5,
        "and the old month's count is left alone"
    );
}

/// An allowance is spent by calls the vendor actually served, not by ones that
/// never reached it — otherwise an outage at the first provider would burn the
/// free tier it is meant to be using.
#[tokio::test]
async fn a_failed_call_does_not_spend_the_allowance() {
    let h = harness_chain(
        limits(100, 1000),
        vec![
            (
                "primary",
                Some(2),
                vec![Err(UpstreamFailure::Transport("down".into()))],
            ),
            ("backup", None, vec![Ok(vec![hit("https://b.test/1")])]),
        ],
    )
    .await;

    let first = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(first.provider, "backup");

    // The next search still tries the first provider: it has spent nothing.
    let second = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(second.provider, "primary");
}

/// An empty answer is a call the vendor served and bills for.
#[tokio::test]
async fn an_empty_answer_still_spends_the_allowance() {
    let h = harness_chain(
        limits(100, 1000),
        vec![
            ("primary", Some(1), vec![Ok(Vec::new())]),
            ("backup", None, vec![Ok(vec![hit("https://b.test/1")])]),
        ],
    )
    .await;

    run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();

    let second = run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();
    assert_eq!(second.provider, "backup");
    assert_eq!(h.upstreams[0].call_count(), 1);
}

/// A provider with no allowance keeps serving indefinitely — the cap is opt-in,
/// and a paid account must not be cut off by it.
#[tokio::test]
async fn an_uncapped_provider_is_never_skipped() {
    let h = harness_chain(
        limits(100, 1000),
        vec![("primary", None, vec![]), ("backup", None, vec![])],
    )
    .await;

    for _ in 0..5 {
        let response = run_search(&h.state, ip(), &request("a query"))
            .await
            .unwrap();
        assert_eq!(response.provider, "primary");
    }
    assert_eq!(h.upstreams[1].call_count(), 0);
}

#[tokio::test]
async fn reports_unavailable_rather_than_failing_when_no_key_is_configured() {
    let h = harness_chain(limits(5, 100), Vec::new()).await;

    let error = run_search(&h.state, ip(), &request("a query"))
        .await
        .expect_err("a broker with no search key cannot serve one");
    assert_eq!(error.error_code(), "search_unavailable");
    assert_eq!(
        error.status_code(),
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    );
    assert!(
        h.upstreams.is_empty(),
        "no providers is exactly what makes it unavailable"
    );
}

#[tokio::test]
async fn rejects_unusable_input_without_spending_anything() {
    let h = harness(limits(5, 100), std::iter::empty()).await;

    let blank_query = SearchRequest {
        install_id: INSTALL.into(),
        query: "   ".into(),
        count: None,
    };
    // Rejected here rather than by the vendor: a one-character query is a
    // guaranteed upstream 400, and letting it through costs a round trip, a
    // reserved slot and a refund to arrive at the same answer.
    let too_short = SearchRequest {
        install_id: INSTALL.into(),
        query: "x".into(),
        count: None,
    };
    let blank_install = SearchRequest {
        install_id: "  ".into(),
        query: "a query".into(),
        count: None,
    };

    for bad in [blank_query, too_short, blank_install] {
        let error = run_search(&h.state, ip(), &bad)
            .await
            .expect_err("bad input");
        assert!(matches!(error, AppError::BadRequest(_)));
    }

    assert_eq!(h.upstream().call_count(), 0);
    assert_eq!(
        store::used_today_global(&h.state.pool, &today())
            .await
            .unwrap(),
        0
    );
}

/// Yesterday's rows are swept on the first search of a new day, so the table
/// does not grow one row per device per day forever.
#[tokio::test]
async fn prunes_counters_from_previous_days() {
    let h = harness(limits(5, 100), std::iter::empty()).await;

    store::reserve(&h.state.pool, INSTALL, "2020-01-01")
        .await
        .unwrap();
    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, "2020-01-01")
            .await
            .unwrap(),
        1
    );

    run_search(&h.state, ip(), &request("a query"))
        .await
        .unwrap();

    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, "2020-01-01")
            .await
            .unwrap(),
        0,
        "the stale day should have been pruned"
    );
    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        1,
        "today must survive its own sweep"
    );
}

/// A refund that arrives twice must not mint quota out of nothing.
#[tokio::test]
async fn a_release_never_drives_the_counter_below_zero() {
    let h = harness(limits(5, 100), std::iter::empty()).await;
    let day = today();

    store::reserve(&h.state.pool, INSTALL, &day).await.unwrap();
    for _ in 0..3 {
        store::release(&h.state.pool, INSTALL, &day).await.unwrap();
    }

    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &day)
            .await
            .unwrap(),
        0
    );
}
