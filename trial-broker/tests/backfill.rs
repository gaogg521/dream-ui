//! The paste-your-key usage query finds a key by the hash taken when it was
//! minted. Keys issued before that column existed have none, so the page
//! rejects a key its owner is actively using — the first real report was
//! exactly that. `backfill::run` re-reveals those keys from the vendor and
//! records the hash, and these tests pin the part that actually matters:
//! a key that could not be looked up before the backfill can be after it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;

use dream_trial_broker::config::Config;
use dream_trial_broker::db::{self, Issuance};
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::service::{hash_key, AppState};
use dream_trial_broker::vendor::{
    IssuedKey, KeySpec, KeyUsage, ProvisioningMode, ResetPeriod, TokenVendor, VendorClientConfig,
    VendorError,
};

const SECRET: &str = "sk-a-key-issued-before-migration-0008";
const HANDLE: &str = "1177";

/// Stands in for Baoyun: can re-reveal a live key's plaintext, and counts
/// how often it was asked.
struct RevealingVendor {
    id: &'static str,
    secret_by_handle: HashMap<String, String>,
    reveal_calls: AtomicUsize,
    revealed: Mutex<Vec<String>>,
}

impl RevealingVendor {
    fn new(id: &'static str, pairs: &[(&str, &str)]) -> Self {
        Self {
            id,
            secret_by_handle: pairs
                .iter()
                .map(|(h, s)| (h.to_string(), s.to_string()))
                .collect(),
            reveal_calls: AtomicUsize::new(0),
            revealed: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl TokenVendor for RevealingVendor {
    fn id(&self) -> &'static str {
        self.id
    }
    fn provisioning_mode(&self) -> ProvisioningMode {
        ProvisioningMode::IssuedKey
    }
    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: "custom",
            base_url: "https://x.example",
            currency: "CNY",
        }
    }
    async fn issue_key(&self, _spec: KeySpec) -> Result<IssuedKey, VendorError> {
        unreachable!()
    }
    async fn read_usage(&self, _handle: &str) -> Result<KeyUsage, VendorError> {
        Ok(KeyUsage {
            limit_usd: Some(16.0),
            used_usd: 0.0,
            remaining_usd: Some(16.0),
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
    async fn set_model_limits(&self, _handle: &str, _unrestricted: bool) -> Result<(), VendorError> {
        Ok(())
    }
    async fn reveal_key(&self, handle: &str) -> Result<String, VendorError> {
        self.reveal_calls.fetch_add(1, Ordering::SeqCst);
        self.revealed.lock().unwrap().push(handle.to_string());
        self.secret_by_handle
            .get(handle)
            .cloned()
            .ok_or(VendorError::Upstream {
                vendor: self.id,
                status: 404,
                body: "no such key".to_string(),
            })
    }
}

/// A vendor with no reveal support at all — OpenRouter's position.
struct PlainVendor;

#[async_trait]
impl TokenVendor for PlainVendor {
    fn id(&self) -> &'static str {
        "plain"
    }
    fn provisioning_mode(&self) -> ProvisioningMode {
        ProvisioningMode::IssuedKey
    }
    fn client_config(&self) -> VendorClientConfig {
        VendorClientConfig {
            platform: "custom",
            base_url: "https://y.example",
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
    async fn set_model_limits(&self, _handle: &str, _unrestricted: bool) -> Result<(), VendorError> {
        Ok(())
    }
}

fn base_config() -> Config {
    Config {
        listen_addr: "127.0.0.1:0".to_string(),
        database_url: "sqlite::memory:".to_string(),
        openrouter_management_key: "test".to_string(),
        baoyun: None,
        daily_budget_usd_cap: 100.0,
        trial_key_limit_usd: 1.0,
        trial_key_limit_reset: ResetPeriod::Cumulative,
        trial_key_expires_days: 90,
        per_ip_rate_limit_per_hour: 1000,
        topup_price_markup: 1.0,
        public_base_url: "http://127.0.0.1:8787".to_string(),
    }
}

async fn insert(pool: &sqlx::SqlitePool, id: &str, vendor: &str, handle: &str, hash: Option<&str>) {
    db::insert_issuance(
        pool,
        &Issuance {
            id: id.to_string(),
            vendor: vendor.to_string(),
            install_id: format!("install-for-{id}"),
            ip: "127.0.0.1".to_string(),
            vendor_key_handle: handle.to_string(),
            issued_at: 0,
            expires_at: 9_999_999_999_999,
            disabled: 0,
            key_hash: hash.map(str::to_string),
        },
    )
    .await
    .unwrap();
}

fn state_with(pool: sqlx::SqlitePool, vendors: Vec<Arc<dyn TokenVendor>>) -> Arc<AppState> {
    let mut map: HashMap<&'static str, Arc<dyn TokenVendor>> = HashMap::new();
    for v in vendors {
        map.insert(v.id(), v);
    }
    Arc::new(AppState {
        pool,
        config: Arc::new(base_config()),
        vendors: map,
        rate_limiter: Arc::new(RateLimiter::new(1000, Duration::from_secs(3600))),
        metered: Arc::new(dream_trial_broker::metered::MeteredRuntime::disabled()),
        search: Arc::new(dream_trial_broker::search::SearchRuntime::disabled()),
    })
}

#[tokio::test]
async fn a_key_issued_before_the_hash_column_becomes_queryable_after_backfill() {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    insert(&pool, "issuance-1", "revealing", HANDLE, None).await;
    let vendor = Arc::new(RevealingVendor::new("revealing", &[(HANDLE, SECRET)]));
    let state = state_with(pool.clone(), vec![vendor.clone()]);

    // Before: the user's own key does not match — the reported bug.
    let before = db::find_active_by_key_hash(&pool, "revealing", &hash_key(SECRET))
        .await
        .unwrap();
    assert!(
        before.is_none(),
        "precondition: not findable before backfill"
    );

    dream_trial_broker::backfill::run(Arc::clone(&state)).await;

    let after = db::find_active_by_key_hash(&pool, "revealing", &hash_key(SECRET))
        .await
        .unwrap()
        .expect("the same key is findable after the backfill");
    assert_eq!(after.id, "issuance-1");
    assert_eq!(after.vendor_key_handle, HANDLE);
}

#[tokio::test]
async fn rows_that_already_have_a_hash_are_left_alone() {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    insert(
        &pool,
        "issuance-1",
        "revealing",
        HANDLE,
        Some(&hash_key(SECRET)),
    )
    .await;
    let vendor = Arc::new(RevealingVendor::new("revealing", &[(HANDLE, SECRET)]));
    let state = state_with(pool.clone(), vec![vendor.clone()]);

    dream_trial_broker::backfill::run(Arc::clone(&state)).await;

    assert_eq!(
        vendor.reveal_calls.load(Ordering::SeqCst),
        0,
        "a key with a hash is never re-revealed"
    );
}

#[tokio::test]
async fn a_vendor_that_cannot_reveal_is_skipped_without_touching_its_rows() {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    insert(&pool, "issuance-1", "plain", "abc", None).await;
    insert(&pool, "issuance-2", "plain", "def", None).await;
    let state = state_with(pool.clone(), vec![Arc::new(PlainVendor)]);

    dream_trial_broker::backfill::run(Arc::clone(&state)).await;

    let left = db::list_active_without_key_hash(&pool, "plain")
        .await
        .unwrap();
    assert_eq!(left.len(), 2, "rows stay NULL, nothing invented for them");
}

#[tokio::test]
async fn one_failing_reveal_does_not_stop_the_rest() {
    let pool = db::init_pool("sqlite::memory:").await.unwrap();
    // "gone" has no secret on the vendor: revealing it errors.
    insert(&pool, "issuance-dead", "revealing", "gone", None).await;
    insert(&pool, "issuance-live", "revealing", HANDLE, None).await;
    let vendor = Arc::new(RevealingVendor::new("revealing", &[(HANDLE, SECRET)]));
    let state = state_with(pool.clone(), vec![vendor.clone()]);

    dream_trial_broker::backfill::run(Arc::clone(&state)).await;

    assert!(
        db::find_active_by_key_hash(&pool, "revealing", &hash_key(SECRET))
            .await
            .unwrap()
            .is_some(),
        "the healthy key is still backfilled"
    );
    let left = db::list_active_without_key_hash(&pool, "revealing")
        .await
        .unwrap();
    assert_eq!(
        left.len(),
        1,
        "only the unrevealable row is left for the next startup"
    );
    assert_eq!(left[0].id, "issuance-dead");
}
