use std::net::IpAddr;
use std::sync::Arc;

use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::config::Config;
use crate::db::{self, Issuance};
use crate::error::AppError;
use crate::rate_limit::RateLimiter;
use crate::vendor::{KeySpec, ProvisioningMode, TokenVendor, VendorError};

#[derive(Debug, Deserialize)]
pub struct TrialKeyRequest {
    pub install_id: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct TrialKeyResponse {
    pub key: String,
    pub base_url: String,
    pub models: Vec<String>,
    /// Which provider platform the client should create this as. Sent so the
    /// client does not have to hardcode one vendor's name to use the key.
    pub platform: String,
    /// Stable vendor id, for anything that needs to distinguish issuers
    /// without parsing the platform label.
    pub vendor: String,
}

/// A key's spend position, for the client's quota display.
#[derive(Debug, Serialize, PartialEq)]
pub struct QuotaStatusResponse {
    pub vendor: String,
    pub limit_usd: Option<f64>,
    pub used_usd: f64,
    pub remaining_usd: Option<f64>,
    /// `monthly`, `daily`, or `cumulative`.
    pub reset: Option<String>,
    pub exhausted: bool,
}

/// Shared application state handed to every request handler.
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub vendor: Arc<dyn TokenVendor>,
    pub rate_limiter: Arc<RateLimiter>,
    /// Mode B. Independent of `vendor` above — its own vendors, its own
    /// tables. Empty when no metered vendor is configured.
    pub metered: Arc<crate::metered::MeteredRuntime>,
}

fn log_vendor_error(error: &VendorError) {
    match error {
        VendorError::Upstream {
            vendor,
            status,
            body,
        } => {
            tracing::error!(vendor, status, body = %body, "vendor call returned an error status");
        }
        VendorError::Request { vendor, message } => {
            tracing::error!(vendor, error = %message, "vendor call failed");
        }
        VendorError::Unsupported { vendor, operation } => {
            tracing::error!(vendor, operation, "vendor does not support this operation");
        }
    }
}

/// The full `POST /v1/trial-keys` flow: dedup -> rate limit -> circuit
/// breaker -> mint upstream -> persist -> respond. Kept independent of the
/// HTTP layer so it can be unit tested directly.
pub async fn issue_trial_key(
    state: &AppState,
    install_id: &str,
    ip: IpAddr,
) -> Result<TrialKeyResponse, AppError> {
    if install_id.trim().is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }

    let vendor_id = state.vendor.id();

    // Refuse before spending anything if this vendor cannot cap a key at all.
    // Issuing an uncapped key would be worse than issuing none.
    if state.vendor.provisioning_mode() != ProvisioningMode::IssuedKey {
        tracing::error!(
            vendor = vendor_id,
            "configured vendor cannot issue capped keys"
        );
        return Err(AppError::Internal("vendor cannot issue capped keys".into()));
    }

    // 1. Dedup by (vendor, install_id).
    match db::find_active_by_install_id(&state.pool, vendor_id, install_id).await {
        Ok(Some(_)) => {
            tracing::info!(
                vendor = vendor_id,
                install_id_hash = %hash_prefix(install_id),
                "dedup rejection: install_id already issued"
            );
            return Err(AppError::AlreadyIssued);
        }
        Ok(None) => {}
        Err(e) => {
            tracing::error!(error = %e, "db error during dedup check");
            return Err(AppError::Internal("database error".into()));
        }
    }

    // 2. Per-IP rate limit.
    if !state.rate_limiter.check(ip) {
        tracing::info!(ip = %ip, "rate limit rejection");
        return Err(AppError::RateLimited);
    }

    // 3. Daily global circuit breaker.
    let now = Utc::now();
    let today_start_ms = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight time")
        .and_utc()
        .timestamp_millis();
    let now_ms = now.timestamp_millis();

    let issued_today = db::count_active_issued_since(&state.pool, today_start_ms, now_ms)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "db error counting today's issuances");
            AppError::Internal("database error".into())
        })?;

    let projected_liability = issued_today as f64 * state.config.trial_key_limit_usd;
    if projected_liability >= state.config.daily_budget_usd_cap {
        tracing::info!(
            count = issued_today,
            threshold_usd = state.config.daily_budget_usd_cap,
            "daily circuit breaker tripped"
        );
        return Err(AppError::BudgetExhausted);
    }

    // 4. Mint upstream.
    let expires_at = now + ChronoDuration::days(state.config.trial_key_expires_days);
    let spec = KeySpec {
        label: format!("onework-trial-{}", short_uuid()),
        limit_usd: state.config.trial_key_limit_usd,
        reset: state.config.trial_key_limit_reset,
        expires_at: Some(expires_at.to_rfc3339_opts(SecondsFormat::Secs, true)),
    };

    let issued = state.vendor.issue_key(spec).await.map_err(|e| {
        log_vendor_error(&e);
        AppError::UpstreamError("failed to issue upstream key".into())
    })?;

    // 5. Persist the issuance (never the plaintext key).
    let issuance = Issuance {
        id: Uuid::new_v4().to_string(),
        vendor: vendor_id.to_string(),
        install_id: install_id.to_string(),
        ip: ip.to_string(),
        vendor_key_handle: issued.handle,
        issued_at: now_ms,
        expires_at: expires_at.timestamp_millis(),
        disabled: 0,
    };

    db::insert_issuance(&state.pool, &issuance)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "failed to persist issuance");
            AppError::Internal("database error".into())
        })?;

    tracing::info!(
        vendor = vendor_id,
        install_id_hash = %hash_prefix(install_id),
        "issued trial key"
    );

    // 6. Respond.
    let client = state.vendor.client_config();
    Ok(TrialKeyResponse {
        key: issued.secret,
        base_url: client.base_url.to_string(),
        models: client.models.iter().map(|s| s.to_string()).collect(),
        platform: client.platform.to_string(),
        vendor: vendor_id.to_string(),
    })
}

/// The `POST /v1/quota/status` flow: find this install's key, ask the vendor
/// where its spend stands.
///
/// Reads by the stored handle, so it never needs the plaintext key — the
/// client holds the only copy of that, and this stays true for the paid tier.
pub async fn read_quota_status(
    state: &AppState,
    install_id: &str,
) -> Result<QuotaStatusResponse, AppError> {
    if install_id.trim().is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }

    let vendor_id = state.vendor.id();
    let issuance = db::find_active_by_install_id(&state.pool, vendor_id, install_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "db error during quota lookup");
            AppError::Internal("database error".into())
        })?
        // Not an error state worth its own code: the caller asked about a key
        // this service never issued. 404 says exactly that.
        .ok_or(AppError::NotIssued)?;

    let usage = state
        .vendor
        .read_usage(&issuance.vendor_key_handle)
        .await
        .map_err(|e| {
            log_vendor_error(&e);
            AppError::UpstreamError("failed to read upstream usage".into())
        })?;

    Ok(QuotaStatusResponse {
        vendor: vendor_id.to_string(),
        limit_usd: usage.limit_usd,
        used_usd: usage.used_usd,
        remaining_usd: usage.remaining_usd,
        reset: usage.reset.map(|r| r.as_str().to_string()),
        exhausted: usage.is_exhausted(),
    })
}

/// A short, non-reversible-enough-to-matter prefix used only for log lines,
/// so we never log a raw install_id.
fn hash_prefix(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    digest[..4].iter().map(|b| format!("{b:02x}")).collect()
}

fn short_uuid() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_string()
}
