//! Mode D (hosted default STT) end to end: quota accounting, the refund on an
//! upstream failure, the global spend cap, and the off switch.
//!
//! The upstream is a scripted stand-in rather than a live Aliyun call — every
//! rule worth testing here is about what the broker does *around* the
//! transcription. The mapping of a real Aliyun response is covered by the
//! unit tests in `stt::tests`, against a body captured from a live 200.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::error::AppError;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::search::SearchRuntime;
use dream_trial_broker::service::AppState;
use dream_trial_broker::stt::service::{run_stt_transcribe, SttRequest};
use dream_trial_broker::stt::{store, SttLimits, SttRuntime, Upstream, UpstreamFailure};
use dream_trial_broker::vendor::openrouter::OpenRouterVendor;
use dream_trial_broker::vendor::TokenVendor;

const INSTALL: &str = "install-abc";

// --- a scripted upstream ------------------------------------------------

struct ScriptedUpstream {
    id: &'static str,
    outcomes: Mutex<std::collections::VecDeque<Result<String, UpstreamFailure>>>,
    calls: Mutex<Vec<String>>,
}

impl ScriptedUpstream {
    fn new(
        id: &'static str,
        script: impl IntoIterator<Item = Result<String, UpstreamFailure>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            id,
            outcomes: Mutex::new(script.into_iter().collect()),
            calls: Mutex::new(Vec::new()),
        })
    }

    fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

struct SharedUpstream(Arc<ScriptedUpstream>);

#[async_trait]
impl Upstream for SharedUpstream {
    fn id(&self) -> &'static str {
        self.0.id
    }

    async fn transcribe(
        &self,
        _audio_base64: &str,
        mime_type: &str,
        _language: Option<&str>,
    ) -> Result<String, UpstreamFailure> {
        self.0.calls.lock().unwrap().push(mime_type.to_string());
        self.0
            .outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Ok("fallback transcript".into()))
    }
}

// --- harness --------------------------------------------------------------

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
        topup_price_markup: 1.0,
        topup_enabled: true,
    }
}

fn limits(per_install: i64, global: i64) -> SttLimits {
    SttLimits {
        daily_limit_per_install: per_install,
        global_daily_limit: global,
        rate_limit_per_hour: 1000,
    }
}

struct Harness {
    state: Arc<AppState>,
    upstream: Arc<ScriptedUpstream>,
}

async fn harness(
    limits: SttLimits,
    script: impl IntoIterator<Item = Result<String, UpstreamFailure>>,
) -> Harness {
    let pool = db::init_pool("sqlite::memory:")
        .await
        .expect("in-memory db should initialize");

    let upstream = ScriptedUpstream::new("primary", script);
    let providers: Vec<Box<dyn Upstream>> = vec![Box::new(SharedUpstream(upstream.clone()))];

    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    let openrouter_vendor: Arc<dyn TokenVendor> =
        Arc::new(OpenRouterVendor::new("unused".to_string()));
    vendors.insert(openrouter_vendor.id(), openrouter_vendor);

    let state = Arc::new(AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(SearchRuntime::disabled()),
        stt: Arc::new(SttRuntime::new(limits, providers)),
    });

    Harness { state, upstream }
}

fn request() -> SttRequest {
    SttRequest {
        install_id: INSTALL.to_string(),
        audio_base64: "AAAA".to_string(),
        mime_type: "audio/webm;codecs=opus".to_string(),
        language: None,
    }
}

fn ip() -> std::net::IpAddr {
    std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, 1))
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

// --- tests ------------------------------------------------------------

#[tokio::test]
async fn serves_a_transcription_and_counts_it_against_the_daily_allowance() {
    let h = harness(limits(3, 100), [Ok("hello world".into())]).await;

    let response = run_stt_transcribe(&h.state, ip(), &request())
        .await
        .expect("transcription should succeed");

    assert_eq!(response.provider, "primary");
    assert_eq!(response.text, "hello world");
    assert_eq!(response.quota.used_today, 1);
    assert_eq!(response.quota.daily_limit, 3);
    assert_eq!(response.quota.remaining, 2);
    // Codec parameters must not reach the vendor.
    assert_eq!(h.upstream.calls.lock().unwrap().as_slice(), ["audio/webm"]);
}

/// Silence is a legitimate transcript, not something the caller falls
/// through or refunds for.
#[tokio::test]
async fn an_empty_transcript_still_counts_as_served() {
    let h = harness(limits(3, 100), [Ok(String::new())]).await;

    let response = run_stt_transcribe(&h.state, ip(), &request())
        .await
        .unwrap();
    assert_eq!(response.text, "");
    assert_eq!(response.quota.used_today, 1);
}

#[tokio::test]
async fn rejects_when_no_provider_is_configured() {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    let openrouter_vendor: Arc<dyn TokenVendor> =
        Arc::new(OpenRouterVendor::new("unused".to_string()));
    vendors.insert(openrouter_vendor.id(), openrouter_vendor);
    let state = Arc::new(AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(SearchRuntime::disabled()),
        stt: Arc::new(SttRuntime::disabled()),
    });
    let error = run_stt_transcribe(&state, ip(), &request())
        .await
        .expect_err("no provider configured");
    assert_eq!(error.error_code(), "stt_unavailable");
}

#[tokio::test]
async fn blocks_the_install_once_its_daily_allowance_is_spent() {
    let h = harness(limits(2, 100), std::iter::empty()).await;

    for expected_used in 1..=2 {
        let response = run_stt_transcribe(&h.state, ip(), &request())
            .await
            .unwrap();
        assert_eq!(response.quota.used_today, expected_used);
    }

    let error = run_stt_transcribe(&h.state, ip(), &request())
        .await
        .expect_err("the third call is over the limit");
    assert_eq!(error.error_code(), "stt_quota_exhausted");

    // The rejected attempt must not leave the counter inflated.
    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        2
    );
    // And it must never have reached the vendor.
    assert_eq!(h.upstream.call_count(), 2);
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
        let error = run_stt_transcribe(&h.state, ip(), &request())
            .await
            .expect_err("upstream failure should surface");
        assert_eq!(error.error_code(), "upstream_error");
    }

    assert_eq!(
        store::used_today(&h.state.pool, INSTALL, &today())
            .await
            .unwrap(),
        0,
        "two failed transcriptions must not have spent any allowance"
    );
}

#[tokio::test]
async fn stops_everyone_once_the_days_global_cap_is_reached() {
    let h = harness(limits(100, 2), std::iter::empty()).await;

    run_stt_transcribe(&h.state, ip(), &request())
        .await
        .unwrap();
    run_stt_transcribe(&h.state, ip(), &request())
        .await
        .unwrap();

    // A different install, nowhere near its own allowance, is still stopped —
    // the cap is on the bill, not on the device.
    let other = SttRequest {
        install_id: "install-other".into(),
        ..request()
    };
    let error = run_stt_transcribe(&h.state, ip(), &other)
        .await
        .expect_err("the global cap should hold");
    assert_eq!(error.error_code(), "stt_budget_exhausted");
    assert_eq!(h.upstream.call_count(), 2);
}

#[tokio::test]
async fn rejects_an_empty_install_id() {
    let h = harness(limits(3, 100), [Ok("hi".into())]).await;
    let error = run_stt_transcribe(
        &h.state,
        ip(),
        &SttRequest {
            install_id: "  ".into(),
            ..request()
        },
    )
    .await
    .expect_err("blank install_id must be rejected");
    assert!(matches!(error, AppError::BadRequest(_)));
}

#[tokio::test]
async fn rejects_oversized_audio() {
    let h = harness(limits(3, 100), [Ok("hi".into())]).await;
    let huge = "A".repeat(dream_trial_broker::stt::MAX_AUDIO_BYTES * 2);
    let error = run_stt_transcribe(
        &h.state,
        ip(),
        &SttRequest {
            audio_base64: huge,
            ..request()
        },
    )
    .await
    .expect_err("oversized audio must be rejected before reaching the vendor");
    assert!(matches!(error, AppError::BadRequest(_)));
    assert_eq!(h.upstream.call_count(), 0);
}
