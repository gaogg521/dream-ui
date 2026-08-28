//! What this service needs from an upstream LLM token platform.
//!
//! The shape is dictated by one property OpenRouter happens to have and not
//! every platform does: it can mint a **sub-key with its own spend cap** on
//! demand. That is what lets this broker stay out of the inference path
//! entirely — it hands the caller a key, the caller talks to the vendor
//! directly, and no request traffic, latency or scaling burden lands here.
//!
//! Do not assume the next platform works that way. Verify it before promising
//! an integration; see [`ProvisioningMode`].

use async_trait::async_trait;

pub mod openrouter;

/// How a vendor can be made to enforce a spend cap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvisioningMode {
    /// The vendor mints capped sub-keys on demand, so the client talks to it
    /// directly and this service is only involved at issuance. The only mode
    /// implemented.
    IssuedKey,
    /// The vendor cannot cap a key, so the only way to bound spend is to sit
    /// in the inference path and meter it here.
    ///
    /// **Declared, not implemented.** It is a different system, not another
    /// `TokenVendor` impl: request forwarding, streaming, token accounting,
    /// latency and bandwidth cost, plus this service becoming a single point
    /// of failure for every conversation. Building it before a vendor
    /// actually needs it would be paying that price for a guess — so the
    /// variant exists to keep the distinction visible when evaluating a
    /// platform, and `issue_key` refuses for any vendor that reports it.
    MeteredProxy,
}

/// How often the vendor resets a key's spend counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResetPeriod {
    /// Renews every calendar month. The trial tier: $1 that comes back.
    Monthly,
    /// Renews every calendar day.
    Daily,
    /// Never renews — spend accumulates against the cap until it is raised.
    /// The shape prepaid top-ups need.
    Cumulative,
}

impl ResetPeriod {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "monthly" => Some(Self::Monthly),
            "daily" => Some(Self::Daily),
            "cumulative" | "none" => Some(Self::Cumulative),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Monthly => "monthly",
            Self::Daily => "daily",
            Self::Cumulative => "cumulative",
        }
    }
}

/// What to mint.
#[derive(Debug, Clone)]
pub struct KeySpec {
    /// Vendor-side label. Not secret, and not an identifier we rely on.
    pub label: String,
    pub limit_usd: f64,
    pub reset: ResetPeriod,
    /// RFC 3339. `None` means the vendor's own default lifetime.
    pub expires_at: Option<String>,
}

/// A freshly minted key. `secret` is returned exactly once, by the vendor, at
/// creation — it is handed to the caller and never stored.
#[derive(Debug, Clone)]
pub struct IssuedKey {
    pub secret: String,
    /// The vendor's own opaque identifier for this key, used for every later
    /// operation on it. For OpenRouter this is the key's hash, which means
    /// usage can be read and limits raised **without ever holding the
    /// plaintext** — the paid tier does not have to weaken that.
    pub handle: String,
}

/// A key's spend position, as the vendor reports it.
#[derive(Debug, Clone, PartialEq)]
pub struct KeyUsage {
    pub limit_usd: Option<f64>,
    pub used_usd: f64,
    pub remaining_usd: Option<f64>,
    pub reset: Option<ResetPeriod>,
    pub disabled: bool,
}

impl KeyUsage {
    /// Whether the allowance is spent. `None` remaining means the vendor
    /// reports no cap at all, which is not exhaustion.
    pub fn is_exhausted(&self) -> bool {
        self.disabled || self.remaining_usd.is_some_and(|remaining| remaining <= 0.0)
    }
}

/// Everything the desktop client needs to turn an issued key into a working
/// provider row. Carrying the platform here is what stops the client from
/// hardcoding one vendor's name.
#[derive(Debug, Clone)]
pub struct VendorClientConfig {
    /// The client's provider-platform identifier, e.g. `OpenRouter`.
    pub platform: &'static str,
    pub base_url: &'static str,
    /// Preset model list, in the order the client should offer them — the
    /// first is what it selects.
    pub models: &'static [&'static str],
}

#[derive(Debug, thiserror::Error)]
pub enum VendorError {
    #[error("{vendor} request failed: {message}")]
    Request {
        vendor: &'static str,
        message: String,
    },
    #[error("{vendor} returned error status {status}: {body}")]
    Upstream {
        vendor: &'static str,
        status: u16,
        body: String,
    },
    /// The vendor cannot do what was asked — currently only
    /// [`ProvisioningMode::MeteredProxy`] reaching an issuance call.
    #[error("{vendor} does not support {operation}")]
    Unsupported {
        vendor: &'static str,
        operation: &'static str,
    },
}

/// An upstream platform this service can mint capped keys on.
///
/// `read_usage`, `set_limit` and `revoke` are addressed by
/// [`IssuedKey::handle`], so none of them needs the plaintext key.
#[async_trait]
pub trait TokenVendor: Send + Sync {
    /// Stable identifier, persisted alongside every issuance and returned to
    /// clients. Changing one is a data migration, not a rename.
    fn id(&self) -> &'static str;

    fn provisioning_mode(&self) -> ProvisioningMode;

    fn client_config(&self) -> VendorClientConfig;

    async fn issue_key(&self, spec: KeySpec) -> Result<IssuedKey, VendorError>;

    /// Reads a key's spend position. Backs both the client's quota display and
    /// any later reconciliation.
    async fn read_usage(&self, handle: &str) -> Result<KeyUsage, VendorError>;

    /// Raises (or lowers) a key's cap — how a top-up is applied.
    ///
    /// Note for whoever wires payment to this: on OpenRouter the new limit is
    /// accepted immediately but takes roughly 15-30 seconds to take effect
    /// upstream. A user who retries the instant their payment succeeds still
    /// gets refused. Measured; see the broker's design doc.
    async fn set_limit(&self, handle: &str, limit_usd: f64) -> Result<(), VendorError>;

    async fn revoke(&self, handle: &str) -> Result<(), VendorError>;
}
