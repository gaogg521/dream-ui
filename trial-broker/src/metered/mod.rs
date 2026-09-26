//! Mode B: the broker sits in the inference path, forwards under one master
//! key, and bounds spend against a local ledger.
//!
//! This is a different system from [`crate::vendor`], not another
//! `TokenVendor` impl — see the mode-A vs mode-B table in
//! `docs/vendor-abstraction-and-paid-tier.zh-CN.md`. The two share no traits
//! and no tables and run side by side in one process.
//!
//! Nothing in this module's core (config, ledger, proxy, orders) knows the
//! word "baoyun". A vendor is a [`MeteredVendorConfig`] plus, where the vendor
//! can be asked what a call actually cost, a [`CostResolver`]. Adding a second
//! metered vendor is a config entry and maybe one resolver impl — it does not
//! touch forwarding, the ledger, or payments.
//!
//! **Not currently wired to any vendor by default.** Baoyun — the vendor
//! [`baoyun`] was originally built for — added a real capped-key API in its
//! `/apis/v1/api-keys` account API (2026-09-20) and moved to mode A
//! ([`crate::vendor::baoyun`]) instead, since mode A is simpler whenever a
//! vendor supports it. [`baoyun`] here (the [`CostResolver`] impl, opt-in on
//! `BAOYUN_MASTER_API_KEY`) is kept as this mode's reference implementation
//! for whatever future vendor genuinely cannot issue a capped key — with no
//! env var set it stays inert and `/v1/metered/*` 404s, same as before.

use async_trait::async_trait;
use axum::http::HeaderMap;
use sha2::{Digest, Sha256};

pub mod baoyun;
pub mod gateway;
pub mod poller;
pub mod proxy;
pub mod service;
pub mod store;

use std::collections::HashMap;
use std::sync::Arc;

/// Wall-clock now in unix milliseconds, the timestamp unit every metered table
/// uses.
pub(crate) fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// SHA-256 hex of a secret. Device tokens are stored only as this.
pub(crate) fn sha256_hex(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A fresh opaque device token. Handed to the client once, at claim, and never
/// stored in plaintext.
pub(crate) fn new_device_token() -> String {
    format!(
        "dtk_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// Everything the broker needs to proxy and bill one upstream metered vendor.
#[derive(Debug, Clone)]
pub struct MeteredVendorConfig {
    /// Stable id, persisted on every row and used in the proxy path
    /// `/v1/metered/{id}/*`. Renaming one is a data migration.
    pub id: &'static str,
    /// Upstream origin the proxy forwards to, no trailing slash,
    /// e.g. `https://ai-api.baoyun.com`.
    pub base_url: String,
    /// The single vendor key the broker holds and swaps in on every forwarded
    /// request. Secret; never logged, never returned to a client.
    pub master_api_key: String,
    /// ISO 4217 code for every amount on this vendor, e.g. `CNY`.
    pub currency: &'static str,
    /// One-time grant handed to a fresh account, in minor units (分).
    pub free_grant_cents: i64,
    /// Preset model list for the client, first entry is the default.
    pub models: Vec<String>,
    /// Top-up packages offered when the balance runs out.
    pub packages: Vec<Package>,
}

impl MeteredVendorConfig {
    pub fn package(&self, id: &str) -> Option<&Package> {
        self.packages.iter().find(|p| p.id == id)
    }
}

/// A top-up option. `credit_cents` is what lands in the balance for a
/// `price_cents` payment — 1:1 for now; whether higher tiers get a bonus is an
/// open product question (handoff doc §7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Package {
    pub id: &'static str,
    pub price_cents: i64,
    pub credit_cents: i64,
}

/// The identity a [`CostResolver`] needs to price one forwarded call.
#[derive(Debug, Clone)]
pub struct ProxiedCall {
    /// The vendor's per-call id, from the `X-AiHub-Request-Id` response header.
    pub request_id: String,
    /// Present when the response announced an async task; the poller uses it to
    /// check for a terminal state before re-querying cost.
    pub task_id: Option<String>,
}

/// What a forwarded call cost, once the vendor can say.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CostOutcome {
    /// Final net charge in minor units (分). Applied to the ledger and done.
    Settled(i64),
    /// The vendor cannot price it yet (async job mid-flight). The request id
    /// goes to `metered_pending_costs` for the background poller to retry.
    Pending,
}

/// Turns a completed proxy call into "this is what it cost".
///
/// Bayun implements this by querying `GET /v1/billing/cost` for the official
/// net figure. A vendor with no such endpoint would fall back to a local
/// usage-times-price-table resolver (which drifts on every price change) — not
/// built until a vendor needs it.
#[async_trait]
pub trait CostResolver: Send + Sync {
    async fn resolve(&self, call: &ProxiedCall) -> Result<CostOutcome, MeteredError>;
}

/// A read-only view of an order handed to a gateway. Borrowed so a gateway
/// cannot stash a mutable order.
#[derive(Debug, Clone, Copy)]
pub struct OrderView<'a> {
    pub id: &'a str,
    pub vendor: &'a str,
    pub package_id: &'a str,
    pub amount_cents: i64,
}

/// What the client needs to actually pay: a QR string, a redirect URL, or the
/// mock marker. Opaque JSON so each gateway carries its own shape.
#[derive(Debug, Clone)]
pub struct PaymentIntent {
    pub gateway_txn_id: String,
    pub payload: serde_json::Value,
}

/// The result of verifying a gateway callback.
#[derive(Debug, Clone)]
pub struct WebhookOutcome {
    /// Our order id, recovered from the verified payload.
    pub order_id: String,
    pub paid: bool,
    pub gateway_txn_id: Option<String>,
}

/// A payment gateway. `Mock` implements it so the whole
/// order -> pay -> credit loop runs before a real merchant account exists
/// (handoff doc Phase 4).
#[async_trait]
pub trait PaymentGateway: Send + Sync {
    /// Stable id persisted on the order (`mock` / `alipay` / `wechat`).
    fn id(&self) -> &'static str;

    /// Registers a pending payment with the gateway and returns what the
    /// client shows the user.
    async fn precreate(&self, order: OrderView<'_>) -> Result<PaymentIntent, MeteredError>;

    /// Verifies a callback's authenticity and reports whether it means paid.
    /// Must be safe to call repeatedly for the same payment.
    async fn verify_webhook(
        &self,
        headers: &HeaderMap,
        body: &[u8],
    ) -> Result<WebhookOutcome, MeteredError>;
}

#[derive(Debug, thiserror::Error)]
pub enum MeteredError {
    #[error("{vendor} request failed: {message}")]
    Request {
        vendor: &'static str,
        message: String,
    },
    #[error("{vendor} returned status {status}: {body}")]
    Upstream {
        vendor: &'static str,
        status: u16,
        body: String,
    },
    #[error("webhook rejected: {0}")]
    WebhookRejected(String),
    #[error("{0}")]
    Other(String),
}

/// Assembled once at startup and shared by every metered handler.
pub struct MeteredRuntime {
    /// Vendor id -> its config. Empty when no metered vendor is configured,
    /// in which case every `/v1/metered/*` route answers 404.
    pub configs: HashMap<&'static str, MeteredVendorConfig>,
    /// Vendor id -> its cost resolver.
    pub resolvers: HashMap<&'static str, Arc<dyn CostResolver>>,
    /// The one gateway in use. Mock until a merchant account lands.
    pub gateway: Arc<dyn PaymentGateway>,
    /// Shared client for forwarded traffic and cost queries.
    pub http: reqwest::Client,
}

impl MeteredRuntime {
    /// A runtime with no vendors — every `/v1/metered/*` route 404s. Used when
    /// nothing is configured and by tests that don't exercise mode B.
    pub fn disabled() -> Self {
        Self {
            configs: HashMap::new(),
            resolvers: HashMap::new(),
            gateway: Arc::new(gateway::MockGateway::new("disabled".to_string())),
            http: reqwest::Client::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.configs.is_empty()
    }

    pub fn config(&self, vendor: &str) -> Option<&MeteredVendorConfig> {
        self.configs.get(vendor)
    }

    pub fn resolver(&self, vendor: &str) -> Option<&Arc<dyn CostResolver>> {
        self.resolvers.get(vendor)
    }
}
