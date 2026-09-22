//! Real-money top-up orders: creation, polling, the reference-mismatch
//! guard, and the once-only credit.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use uuid::Uuid;

use dream_trial_broker::config::Config;
use dream_trial_broker::db::{self, Issuance};
use dream_trial_broker::error::AppError;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::service::AppState;
use dream_trial_broker::topup::{create_topup_order, get_topup_order, list_topups};
use dream_trial_broker::vendor::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, TopupOrder,
    TopupOrderSpec, TopupOrderStatus, VendorClientConfig, VendorError,
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
    let topups = list_topups(&state, VENDOR_ID, None)
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
    let topups = list_topups(&state, VENDOR_ID, None).await.unwrap();
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

    let topups = list_topups(&state, VENDOR_ID, None).await.unwrap();
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
    let scoped = list_topups(&state, VENDOR_ID, Some("install-1"))
        .await
        .unwrap();
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped[0].install_id, "install-1");

    let scoped_to_other = list_topups(&state, VENDOR_ID, Some("install-2"))
        .await
        .unwrap();
    assert!(scoped_to_other.is_empty());
}

#[tokio::test]
async fn listing_topups_for_an_unknown_vendor_is_404() {
    let (state, _vendor) = make_state(Some("install-1")).await;
    let err = list_topups(&state, "not-a-vendor", None)
        .await
        .expect_err("unknown vendor must be refused");
    assert!(matches!(err, AppError::VendorUnknown));
}
