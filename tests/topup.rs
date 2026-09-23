//! Real-money top-up orders: creation, polling, the reference-mismatch
//! guard, and the once-only credit.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use uuid::Uuid;

use dream_trial_broker::config::Config;
use dream_trial_broker::db::{self, Issuance};
use dream_trial_broker::error::AppError;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::service::{hash_key, AppState};
use dream_trial_broker::topup::{
    create_topup_order, get_topup_order, list_topups, usage_by_key, usage_history,
};
use dream_trial_broker::vendor::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, TopupOrder,
    TopupOrderSpec, TopupOrderStatus, UsageLogEntry, UsageLogKind, VendorClientConfig, VendorError,
};

const VENDOR_ID: &str = "toppable";
const HANDLE: &str = "mock-handle";

/// A vendor that supports top-up orders — unlike `trial_keys.rs`'s
/// `MockVendor`, which deliberately does not override them (that is what
/// exercises the trait's `Unsupported` default elsewhere).
struct ToppableVendor {
    order_status: Mutex<TopupOrderStatus>,
    /// What `reference` to echo back on `get_topup_order` — lets a test
    /// simulate a mismatched order.
    order_reference: Mutex<Option<String>>,
    top_up_calls: Mutex<Vec<(String, f64)>>,
    last_create_spec: Mutex<Option<TopupOrderSpec>>,
}

impl ToppableVendor {
    fn new() -> Self {
        Self {
            order_status: Mutex::new(TopupOrderStatus::Pending),
            order_reference: Mutex::new(None),
            top_up_calls: Mutex::new(Vec::new()),
            last_create_spec: Mutex::new(None),
        }
    }

    fn set_status(&self, status: TopupOrderStatus) {
        *self.order_status.lock().unwrap() = status;
    }

    fn top_up_call_count(&self) -> usize {
        self.top_up_calls.lock().unwrap().len()
    }
}

#[async_trait]
impl TokenVendor for ToppableVendor {
    fn id(&self) -> &'static str {
        VENDOR_ID
    }

    fn provisioning_mode(&self) -> ProvisioningMode {
        ProvisioningMode::IssuedKey
    }

    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: "MockPlatform",
            base_url: "https://mock.example/v1",
            currency: "CNY",
        }
    }

    async fn issue_key(&self, _spec: KeySpec) -> Result<IssuedKey, VendorError> {
        Ok(IssuedKey {
            secret: "sk-mock".into(),
            handle: HANDLE.into(),
            models: vec!["mock/model".into()],
        })
    }

    async fn read_usage(&self, _handle: &str) -> Result<KeyUsage, VendorError> {
        Ok(KeyUsage {
            limit_usd: Some(10.0),
            used_usd: 0.0,
            remaining_usd: Some(10.0),
            reset: Some(ResetPeriod::Cumulative),
            disabled: false,
            currency: "CNY".into(),
        })
    }

    async fn set_limit(&self, _handle: &str, _limit_usd: f64) -> Result<(), VendorError> {
        Ok(())
    }

    async fn revoke(&self, _handle: &str) -> Result<(), VendorError> {
        Ok(())
    }

    async fn top_up(&self, handle: &str, delta_usd: f64) -> Result<KeyUsage, VendorError> {
        self.top_up_calls
            .lock()
            .unwrap()
            .push((handle.to_string(), delta_usd));
        self.read_usage(handle).await
    }

    async fn create_topup_order(&self, spec: TopupOrderSpec) -> Result<TopupOrder, VendorError> {
        *self.order_reference.lock().unwrap() = Some(spec.reference.clone());
        *self.last_create_spec.lock().unwrap() = Some(spec.clone());
        Ok(TopupOrder {
            id: "order-1".into(),
            status: TopupOrderStatus::Pending,
            currency: "CNY".into(),
            amount: 10.0,
            reference: self.order_reference.lock().unwrap().clone(),
            qr_code: Some("https://pay.example/qr".into()),
            expires_at: Some(9_999_999_999),
            completed_at: None,
        })
    }

    async fn get_topup_order(&self, order_id: &str) -> Result<TopupOrder, VendorError> {
        let status = *self.order_status.lock().unwrap();
        let reference = self.order_reference.lock().unwrap().clone();
        Ok(TopupOrder {
            id: order_id.to_string(),
            status,
            currency: "CNY".into(),
            amount: 10.0,
            reference,
            qr_code: None,
            completed_at: (status == TopupOrderStatus::Success).then_some(1_700_000_000),
            expires_at: None,
        })
    }
}

fn base_config() -> Config {
    Config {
        openrouter_management_key: "unused".to_string(),
        baoyun: None,
        database_url: "sqlite::memory:".to_string(),
        daily_budget_usd_cap: 50.0,
        trial_key_limit_usd: 1.0,
        trial_key_limit_reset: ResetPeriod::Monthly,
        trial_key_expires_days: 90,
        listen_addr: "0.0.0.0:8787".to_string(),
        per_ip_rate_limit_per_hour: 5,
        public_base_url: "http://127.0.0.1:8787".to_string(),
        topup_price_markup: 1.0,
    }
}

/// Builds state with `ToppableVendor` registered, optionally with an active
/// issuance already on file for `install_id` (most tests need one — top-up
/// only makes sense against a claimed key).
async fn make_state(with_issuance_for: Option<&str>) -> (AppState, Arc<ToppableVendor>) {
    let pool = db::init_pool("sqlite::memory:")
        .await
        .expect("in-memory db should initialize");

    if let Some(install_id) = with_issuance_for {
        db::insert_issuance(
            &pool,
            &Issuance {
                id: Uuid::new_v4().to_string(),
                vendor: VENDOR_ID.to_string(),
                install_id: install_id.to_string(),
                ip: "127.0.0.1".to_string(),
                vendor_key_handle: HANDLE.to_string(),
                issued_at: 0,
                expires_at: 9_999_999_999_999,
                disabled: 0,
                key_hash: None,
            },
        )
        .await
        .expect("seed issuance should insert");
    }

    let vendor = Arc::new(ToppableVendor::new());
    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    let dyn_vendor: Arc<dyn TokenVendor> = vendor.clone();
    vendors.insert(VENDOR_ID, dyn_vendor);

    let state = AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    };
    (state, vendor)
}

#[tokio::test]
async fn creating_an_order_requires_an_existing_issuance() {
    let (state, _vendor) = make_state(None).await;
    let err = create_topup_order(&state, VENDOR_ID, "install-none", 10.0)
        .await
        .expect_err("no issuance means nothing to eventually credit");
    assert!(matches!(err, AppError::NotIssued));
}

#[tokio::test]
async fn creating_an_order_rejects_a_non_positive_amount() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    let err = create_topup_order(&state, VENDOR_ID, "install-1", 0.0)
        .await
        .expect_err("zero amount should be rejected");
    assert!(matches!(err, AppError::BadRequest(_)));
}

#[tokio::test]
async fn creating_an_order_tags_it_with_the_vendor_and_install_reference() {
    let (state, vendor) = make_state(Some("install-1")).await;
    let order = create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .expect("order should be created");

    assert_eq!(order.status, "pending");
    assert_eq!(order.qr_code.as_deref(), Some("https://pay.example/qr"));

    let spec = vendor.last_create_spec.lock().unwrap().clone().unwrap();
    assert_eq!(spec.reference, format!("{VENDOR_ID}:install-1"));
    assert!(!spec.idempotency_key.is_empty());
}

#[tokio::test]
async fn creating_an_order_for_an_unconfigured_vendor_is_404() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    let err = create_topup_order(&state, "not-a-vendor", "install-1", 10.0)
        .await
        .expect_err("unknown vendor must be refused");
    assert!(matches!(err, AppError::VendorUnknown));
}

/// `trial_keys.rs`'s `MockVendor` never overrides `create_topup_order`, so it
/// falls onto the trait's default `Unsupported` — this is what a real vendor
/// without a top-up-order API (OpenRouter, today) looks like from the
/// caller's side.
#[tokio::test]
async fn a_vendor_without_topup_support_reports_unsupported() {
    struct NoTopupVendor;

    #[async_trait]
    impl TokenVendor for NoTopupVendor {
        fn id(&self) -> &'static str {
            "no-topup"
        }
        fn provisioning_mode(&self) -> ProvisioningMode {
            ProvisioningMode::IssuedKey
        }
        fn client_config(&self) -> VendorClientConfig {
            VendorClientConfig {
                platform: "X",
                base_url: "https://x.example",
                currency: "USD",
            }
        }
        async fn issue_key(&self, _spec: KeySpec) -> Result<IssuedKey, VendorError> {
            unreachable!()
        }
        async fn read_usage(&self, _handle: &str) -> Result<KeyUsage, VendorError> {
            unreachable!()
        }
        async fn set_limit(&self, _handle: &str, _limit_usd: f64) -> Result<(), VendorError> {
            unreachable!()
        }
        async fn revoke(&self, _handle: &str) -> Result<(), VendorError> {
            unreachable!()
        }
    }

    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    db::insert_issuance(
        &pool,
        &Issuance {
            id: Uuid::new_v4().to_string(),
            vendor: "no-topup".to_string(),
            install_id: "install-1".to_string(),
            ip: "127.0.0.1".to_string(),
            vendor_key_handle: HANDLE.to_string(),
            issued_at: 0,
            expires_at: 9_999_999_999_999,
            disabled: 0,
            key_hash: None,
        },
    )
    .await
    .unwrap();

    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    vendors.insert("no-topup", Arc::new(NoTopupVendor));
    let state = AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    };

    let err = create_topup_order(&state, "no-topup", "install-1", 10.0)
        .await
        .expect_err("a vendor with no topup-order API must be refused");
    assert!(matches!(err, AppError::TopupUnsupported));
}

#[tokio::test]
async fn polling_a_pending_order_does_not_credit_anything() {
    let (state, vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();

    let order = get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect("poll should succeed");

    assert_eq!(order.status, "pending");
    assert_eq!(vendor.top_up_call_count(), 0);
}

#[tokio::test]
async fn a_successful_order_credits_the_polling_installs_key_exactly_once() {
    let (state, vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    vendor.set_status(TopupOrderStatus::Success);

    let first = get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect("first poll should succeed and credit");
    assert_eq!(first.status, "success");
    assert_eq!(vendor.top_up_call_count(), 1);
    assert_eq!(
        vendor.top_up_calls.lock().unwrap()[0],
        (HANDLE.to_string(), 10.0)
    );

    // A client that keeps polling after seeing `success` (or a retried
    // request) must not double-credit.
    let second = get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect("second poll should still succeed, just not credit again");
    assert_eq!(second.status, "success");
    assert_eq!(vendor.top_up_call_count(), 1, "must not credit twice");
}

#[tokio::test]
async fn a_reference_mismatch_is_refused_not_reported() {
    let (state, vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    // Simulate polling with an id whose order actually belongs to a
    // different install (its `reference` won't match `toppable:install-1`).
    *vendor.order_reference.lock().unwrap() = Some(format!("{VENDOR_ID}:someone-else"));
    vendor.set_status(TopupOrderStatus::Success);

    let err = get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect_err("a mismatched reference must be refused");
    assert!(matches!(err, AppError::TopupOrderMismatch));
    assert_eq!(
        vendor.top_up_call_count(),
        0,
        "must never credit on a reference mismatch"
    );
}

#[tokio::test]
async fn polling_without_an_issuance_is_not_issued() {
    let (state, _vendor) = make_state(None).await;
    let err = get_topup_order(&state, VENDOR_ID, "install-none", "order-1")
        .await
        .expect_err("polling an install with no key has nothing to credit");
    assert!(matches!(err, AppError::NotIssued));
}

// --- /internal/vendors/:vendor/topups (the reconciliation listing) -------

#[tokio::test]
async fn listing_topups_is_empty_before_anything_is_credited() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    let topups = list_topups(&state, VENDOR_ID, None, None)
        .await
        .expect("listing should succeed even with nothing credited yet");
    assert!(topups.is_empty());
}

#[tokio::test]
async fn listing_topups_does_not_show_a_still_pending_order() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    // Never polled to success — nothing should have been credited.
    let topups = list_topups(&state, VENDOR_ID, None, None).await.unwrap();
    assert!(topups.is_empty());
}

#[tokio::test]
async fn listing_topups_shows_a_credited_order_with_its_vendor_key_handle() {
    let (state, vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    vendor.set_status(TopupOrderStatus::Success);
    get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect("poll should credit");

    let topups = list_topups(&state, VENDOR_ID, None, None).await.unwrap();
    assert_eq!(topups.len(), 1);
    assert_eq!(topups[0].order_id, "order-1");
    assert_eq!(topups[0].install_id, "install-1");
    assert_eq!(topups[0].vendor_key_handle.as_deref(), Some(HANDLE));
    assert_eq!(topups[0].amount, 10.0);
}

#[tokio::test]
async fn listing_topups_can_be_scoped_to_one_install() {
    let (state, vendor) = make_state(Some("install-1")).await;
    db::insert_issuance(
        &state.pool,
        &Issuance {
            id: Uuid::new_v4().to_string(),
            vendor: VENDOR_ID.to_string(),
            install_id: "install-2".to_string(),
            ip: "127.0.0.1".to_string(),
            vendor_key_handle: "other-handle".to_string(),
            issued_at: 0,
            expires_at: 9_999_999_999_999,
            disabled: 0,
            key_hash: None,
        },
    )
    .await
    .unwrap();

    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    vendor.set_status(TopupOrderStatus::Success);
    get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .unwrap();

    // install-2 never actually paid — only install-1's credit should show
    // up when scoped, and the unscoped listing must still see both none
    // (install-2 has zero credits) so this also doubles as a check that the
    // filter doesn't accidentally hide install-1's own row.
    let scoped = list_topups(&state, VENDOR_ID, Some("install-1"), None)
        .await
        .unwrap();
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].install_id, "install-1");

    let scoped_to_other = list_topups(&state, VENDOR_ID, Some("install-2"), None)
        .await
        .unwrap();
    assert!(scoped_to_other.is_empty());
}

/// The direction Baoyun's own support pointed at: their wallet console's
/// "交易号" column is this broker's order id, so an operator staring at an
/// unfamiliar row there should be able to paste it in and find the install.
#[tokio::test]
async fn listing_topups_can_be_scoped_to_one_order_id() {
    let (state, vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    vendor.set_status(TopupOrderStatus::Success);
    get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .unwrap();

    let found = list_topups(&state, VENDOR_ID, None, Some("order-1"))
        .await
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].install_id, "install-1");

    let not_found = list_topups(&state, VENDOR_ID, None, Some("some-other-order"))
        .await
        .unwrap();
    assert!(not_found.is_empty());
}

#[tokio::test]
async fn listing_topups_for_an_unknown_vendor_is_404() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    let err = list_topups(&state, "not-a-vendor", None, None)
        .await
        .expect_err("unknown vendor must be refused");
    assert!(matches!(err, AppError::VendorUnknown));
}

// --- resale markup ---------------------------------------------------

/// Builds state identically to `make_state`, except with a custom
/// `topup_price_markup` instead of `base_config()`'s no-op `1.0` — kept
/// separate rather than parameterizing `make_state` itself, since only the
/// markup tests below need it.
async fn make_state_with_markup(
    with_issuance_for: Option<&str>,
    markup: f64,
) -> (AppState, Arc<ToppableVendor>) {
    let (state, vendor) = make_state(with_issuance_for).await;
    let state = AppState {
        config: Arc::new(Config {
            topup_price_markup: markup,
            ..(*state.config).clone()
        }),
        ..state
    };
    (state, vendor)
}

#[tokio::test]
async fn a_successful_order_credits_the_marked_up_amount_not_the_raw_payment() {
    let (state, vendor) = make_state_with_markup(Some("install-1"), 1.25).await;
    // `ToppableVendor::create_topup_order`/`get_topup_order` always report a
    // settled `amount` of 10.0 (see its impl above) regardless of what's
    // requested here — same as a real vendor, whose reported order amount is
    // authoritative over whatever the client originally asked to pay.
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    vendor.set_status(TopupOrderStatus::Success);

    get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect("poll should succeed and credit");

    assert_eq!(vendor.top_up_call_count(), 1);
    // The vendor is credited the markup-adjusted amount (10.0 / 1.25 = 8.0)...
    assert_eq!(
        vendor.top_up_calls.lock().unwrap()[0],
        (HANDLE.to_string(), 8.0)
    );
    // ...but the reconciliation view still shows what was actually paid, not
    // the discounted grant — that's the real money that changed hands.
    let topups = list_topups(&state, VENDOR_ID, None, None).await.unwrap();
    assert_eq!(topups[0].amount, 10.0);
}

// --- vendor_key_handle recorded at credit time ------------------------

#[tokio::test]
async fn a_credited_orders_vendor_key_handle_survives_a_later_key_rotation() {
    let (state, vendor) = make_state(Some("install-1")).await;
    create_topup_order(&state, VENDOR_ID, "install-1", 10.0)
        .await
        .unwrap();
    vendor.set_status(TopupOrderStatus::Success);
    get_topup_order(&state, VENDOR_ID, "install-1", "order-1")
        .await
        .expect("poll should credit against the original handle");

    // Simulate the key-recovery flow rotating this install's issuance to a
    // brand new vendor key handle (see `service::recover_deleted_key`) — look
    // up the real (randomly generated) issuance id rather than assuming one,
    // so the UPDATE below actually matches a row instead of silently
    // affecting zero.
    let issuance = db::find_active_by_install_id(&state.pool, VENDOR_ID, "install-1")
        .await
        .unwrap()
        .expect("install-1 should still have an active issuance");
    db::replace_issuance_key(
        &state.pool,
        &issuance.id,
        "rotated-handle",
        0,
        9_999_999_999_999,
        "rotated-key-hash",
    )
    .await
    .expect("rotation should persist");

    // Sanity check the rotation actually took effect before asserting the
    // historical order was unaffected by it.
    let rotated = db::find_active_by_install_id(&state.pool, VENDOR_ID, "install-1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rotated.vendor_key_handle, "rotated-handle");

    let topups = list_topups(&state, VENDOR_ID, None, None).await.unwrap();
    assert_eq!(topups.len(), 1);
    assert_eq!(
        topups[0].vendor_key_handle.as_deref(),
        Some(HANDLE),
        "the historical order must still point at the handle that was live \
         when it was credited, not the post-rotation one"
    );
}

// --- /internal/vendors/:vendor/usage/:install_id -----------------------

/// A vendor that implements `usage_logs` — unlike `ToppableVendor`, which
/// deliberately doesn't override it, exercising the trait's `Unsupported`
/// default (what OpenRouter looks like today).
struct UsageLoggingVendor {
    entries: Vec<UsageLogEntry>,
}

#[async_trait]
impl TokenVendor for UsageLoggingVendor {
    fn id(&self) -> &'static str {
        "usage-logging"
    }
    fn provisioning_mode(&self) -> ProvisioningMode {
        ProvisioningMode::IssuedKey
    }
    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: "X",
            base_url: "https://x.example",
            currency: "CNY",
        }
    }
    async fn issue_key(&self, _spec: KeySpec) -> Result<IssuedKey, VendorError> {
        unreachable!()
    }
    async fn read_usage(&self, _handle: &str) -> Result<KeyUsage, VendorError> {
        Ok(KeyUsage {
            limit_usd: Some(15.0),
            used_usd: 2.5,
            remaining_usd: Some(12.5),
            reset: Some(ResetPeriod::Cumulative),
            disabled: false,
            currency: "CNY".to_string(),
        })
    }
    async fn set_limit(&self, _handle: &str, _limit_usd: f64) -> Result<(), VendorError> {
        unreachable!()
    }
    async fn revoke(&self, _handle: &str) -> Result<(), VendorError> {
        unreachable!()
    }
    async fn usage_logs(
        &self,
        _handle: &str,
        _since_ms: Option<i64>,
    ) -> Result<Vec<UsageLogEntry>, VendorError> {
        Ok(self.entries.clone())
    }
}

fn usage_entry(id: &str, kind: UsageLogKind, amount: f64) -> UsageLogEntry {
    UsageLogEntry {
        id: id.to_string(),
        kind,
        created_at: 1_700_000_000,
        model: "gpt-5.4".to_string(),
        amount,
        prompt_tokens: 100,
        completion_tokens: 50,
        use_time_ms: 1234,
        request_id: format!("req-{id}"),
        is_stream: true,
    }
}

#[tokio::test]
async fn a_vendor_without_usage_log_support_reports_unsupported() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    let err = usage_history(&state, VENDOR_ID, "install-1", None)
        .await
        .expect_err("ToppableVendor never overrides usage_logs");
    assert!(matches!(err, AppError::UsageLogsUnsupported));
}

#[tokio::test]
async fn usage_history_passes_through_the_vendors_log_entries() {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    db::insert_issuance(
        &pool,
        &Issuance {
            id: "issuance-1".to_string(),
            vendor: "usage-logging".to_string(),
            install_id: "install-1".to_string(),
            ip: "127.0.0.1".to_string(),
            vendor_key_handle: HANDLE.to_string(),
            issued_at: 0,
            expires_at: 9_999_999_999_999,
            disabled: 0,
            key_hash: None,
        },
    )
    .await
    .unwrap();

    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    vendors.insert(
        "usage-logging",
        Arc::new(UsageLoggingVendor {
            entries: vec![
                usage_entry("log-1", UsageLogKind::Charge, 0.12),
                usage_entry("log-2", UsageLogKind::Error, 0.0),
            ],
        }),
    );
    let state = AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    };

    let logs = usage_history(&state, "usage-logging", "install-1", None)
        .await
        .expect("a vendor that implements usage_logs should succeed");
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].id, "log-1");
    assert_eq!(logs[0].kind, "charge");
    assert_eq!(logs[1].kind, "error");
}

fn ip() -> IpAddr {
    IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))
}

async fn make_state_with_usage_logging_vendor(key_hash: Option<String>) -> AppState {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    db::insert_issuance(
        &pool,
        &Issuance {
            id: "issuance-1".to_string(),
            vendor: "usage-logging".to_string(),
            install_id: "install-1".to_string(),
            ip: "127.0.0.1".to_string(),
            vendor_key_handle: HANDLE.to_string(),
            issued_at: 0,
            expires_at: 9_999_999_999_999,
            disabled: 0,
            key_hash,
        },
    )
    .await
    .unwrap();

    let mut vendors: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    vendors.insert(
        "usage-logging",
        Arc::new(UsageLoggingVendor {
            entries: vec![usage_entry("log-1", UsageLogKind::Charge, 0.12)],
        }),
    );
    AppState {
        pool,
        config: Arc::new(base_config()),
        vendors,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    }
}

#[tokio::test]
async fn usage_by_key_matches_an_active_issuance_and_returns_balance_plus_logs() {
    let state = make_state_with_usage_logging_vendor(Some(hash_key("sk-real-secret"))).await;

    let result = usage_by_key(&state, "usage-logging", "sk-real-secret", ip())
        .await
        .expect("the exact key that was issued should match its own hash");

    assert_eq!(result.limit_usd, Some(15.0));
    assert_eq!(result.used_usd, 2.5);
    assert_eq!(result.remaining_usd, Some(12.5));
    assert_eq!(result.currency, "CNY");
    assert_eq!(result.logs.len(), 1);
    assert_eq!(result.logs[0].id, "log-1");
}

#[tokio::test]
async fn usage_by_key_for_an_unmatched_key_is_key_not_found() {
    let state = make_state_with_usage_logging_vendor(Some(hash_key("sk-real-secret"))).await;

    let err = usage_by_key(&state, "usage-logging", "sk-a-different-key", ip())
        .await
        .expect_err("a key nobody issued must not match anything");
    assert!(matches!(err, AppError::KeyNotFound));
}

#[tokio::test]
async fn usage_by_key_for_an_unconfigured_vendor_is_vendor_unknown() {
    let state = make_state_with_usage_logging_vendor(Some(hash_key("sk-real-secret"))).await;

    let err = usage_by_key(&state, "not-a-vendor", "sk-real-secret", ip())
        .await
        .expect_err("unknown vendor must be refused");
    assert!(matches!(err, AppError::VendorUnknown));
}

#[tokio::test]
async fn usage_by_key_stops_matching_a_hash_after_the_key_is_rotated_away() {
    let state = make_state_with_usage_logging_vendor(Some(hash_key("sk-old-key"))).await;

    // The old key still matches before any rotation.
    usage_by_key(&state, "usage-logging", "sk-old-key", ip())
        .await
        .expect("the original key should still match before rotation");

    // Simulate key-recovery rotating this issuance onto a brand new key —
    // `replace_issuance_key` overwrites both the handle and the hash.
    db::replace_issuance_key(
        &state.pool,
        "issuance-1",
        "rotated-handle",
        0,
        9_999_999_999_999,
        &hash_key("sk-new-key"),
    )
    .await
    .expect("rotation should persist");

    let err = usage_by_key(&state, "usage-logging", "sk-old-key", ip())
        .await
        .expect_err("the rotated-away key's hash must no longer match anything");
    assert!(matches!(err, AppError::KeyNotFound));

    usage_by_key(&state, "usage-logging", "sk-new-key", ip())
        .await
        .expect("the new key should match after rotation");
}

#[tokio::test]
async fn usage_history_for_an_install_with_no_issuance_is_not_issued() {
    let (state, _vendor) = make_state(None).await;
    let err = usage_history(&state, VENDOR_ID, "install-none", None)
        .await
        .expect_err("no issuance means nothing to look up a handle for");
    assert!(matches!(err, AppError::NotIssued));
}
