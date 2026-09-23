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
use crate::vendor::{baoyun, KeySpec, ProvisioningMode, ResetPeriod, TokenVendor, VendorError};

#[derive(Debug, Deserialize)]
pub struct TrialKeyRequest {
    pub install_id: String,
    pub vendor: String,
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
    /// ISO 4217 code for `limit_usd`-style fields the client reads later from
    /// `/v1/quota/status`. Not itself an amount field here, but sent from the
    /// same call site that will report one.
    pub currency: String,
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
    /// ISO 4217 code the amount fields above are denominated in.
    pub currency: String,
}

/// How generously this broker issues a trial key on one vendor: the cap
/// amount (in that vendor's own currency), how it resets, and the daily
/// liability ceiling across all issuances on that vendor.
///
/// A flat `match` over two known vendors rather than a config map: mode A has
/// exactly the vendors wired into `AppState.vendors`, each with its own env
/// block (see `Config`), and a third vendor is rare enough that adding its
/// arm here is proportionate — unlike mode B, which is built to take vendors
/// nobody has written yet.
pub(crate) struct VendorIssuancePolicy {
    pub(crate) limit_amount: f64,
    pub(crate) reset: ResetPeriod,
    pub(crate) daily_budget_cap: f64,
}

/// Shared application state handed to every request handler.
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    /// Mode A vendors, keyed by [`TokenVendor::id`]. OpenRouter is always
    /// present (its management key is required at startup); Baoyun is
    /// opt-in on `BAOYUN_ACCESS_TOKEN`.
    pub vendors: std::collections::HashMap<&'static str, Arc<dyn TokenVendor>>,
    pub rate_limiter: Arc<RateLimiter>,
    /// Mode B. Independent of `vendors` above — its own vendors, its own
    /// tables. Empty when no metered vendor is configured.
    pub metered: Arc<crate::metered::MeteredRuntime>,
    /// Mode C. Also independent: its own key, its own table, its own limiter.
    /// Disabled when no search key is configured.
    pub search: Arc<crate::search::SearchRuntime>,
}

impl AppState {
    /// Baoyun gets its own dedicated, opt-in config block (see `Config`);
    /// every other vendor id falls back to the general `trial_key_limit_*` /
    /// `daily_budget_usd_cap` fields. That fallback is deliberately not
    /// scoped to `openrouter::ID` specifically: those fields have no
    /// OpenRouter-specific shape (they're just "amount, reset, daily cap"),
    /// so a vendor registered in `AppState.vendors` without its own block —
    /// today only ever OpenRouter, or a test double — gets a sensible policy
    /// rather than `VendorUnknown` for a vendor the caller already resolved.
    pub(crate) fn issuance_policy(&self, vendor_id: &str) -> VendorIssuancePolicy {
        if vendor_id == baoyun::ID {
            if let Some(c) = &self.config.baoyun {
                return VendorIssuancePolicy {
                    limit_amount: c.trial_key_limit_cny,
                    reset: ResetPeriod::Cumulative,
                    daily_budget_cap: c.daily_budget_cny_cap,
                };
            }
        }
        VendorIssuancePolicy {
            limit_amount: self.config.trial_key_limit_usd,
            reset: self.config.trial_key_limit_reset,
            daily_budget_cap: self.config.daily_budget_usd_cap,
        }
    }
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
    vendor_id: &str,
    install_id: &str,
    ip: IpAddr,
) -> Result<TrialKeyResponse, AppError> {
    if install_id.trim().is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }

    let vendor = state
        .vendors
        .get(vendor_id)
        .ok_or(AppError::VendorUnknown)?;
    let policy = state.issuance_policy(vendor_id);

    // Refuse before spending anything if this vendor cannot cap a key at all.
    // Issuing an uncapped key would be worse than issuing none.
    if vendor.provisioning_mode() != ProvisioningMode::IssuedKey {
        tracing::error!(
            vendor = vendor_id,
            "configured vendor cannot issue capped keys"
        );
        return Err(AppError::Internal("vendor cannot issue capped keys".into()));
    }

    // 1. Dedup by (vendor, install_id) — but a *broken* existing issuance
    // (the vendor reports the key itself is gone) gets recovered instead of
    // permanently locking this install out. See `recover_or_reveal`.
    match db::find_active_by_install_id(&state.pool, vendor_id, install_id).await {
        Ok(Some(existing)) => {
            return recover_or_reveal(state, vendor.as_ref(), vendor_id, install_id, ip, &existing)
                .await;
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

    // 3. Daily circuit breaker, scoped to this vendor: liability in one
    // vendor's currency must never gate issuance on another's.
    let now = Utc::now();
    let today_start_ms = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("valid midnight time")
        .and_utc()
        .timestamp_millis();
    let now_ms = now.timestamp_millis();

    let issued_today =
        db::count_active_issued_since(&state.pool, vendor_id, today_start_ms, now_ms)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "db error counting today's issuances");
                AppError::Internal("database error".into())
            })?;

    let projected_liability = issued_today as f64 * policy.limit_amount;
    if projected_liability >= policy.daily_budget_cap {
        tracing::info!(
            vendor = vendor_id,
            count = issued_today,
            threshold = policy.daily_budget_cap,
            "daily circuit breaker tripped"
        );
        return Err(AppError::BudgetExhausted);
    }

    // 4. Mint upstream. Even though no local issuance row exists for this
    // install, it may still have real payment history the broker's own
    // bookkeeping lost track of (e.g. this exact row disappearing from the
    // local db is what motivated this check) — ask the vendor's own order
    // history before minting, same safety net `recover_deleted_key` uses
    // when an existing-but-dead row is found. `paid_total == 0.0` (the
    // overwhelming majority of fresh installs) leaves behavior identical to
    // before this check existed.
    let reference = crate::topup::reference_for(vendor_id, install_id);
    let paid_total = match vendor.paid_total(&reference).await {
        Ok(total) => total,
        Err(VendorError::Unsupported { .. }) => 0.0,
        Err(e) => {
            // Unlike `recover_or_reveal`'s existing-row path (where a failed
            // check must not be treated as "key confirmed gone"), failing
            // open here only risks missing a rare recovery-worthy case, not
            // wrongly discarding a still-good key — so a transient failure
            // must not block every brand-new install's free trial.
            log_vendor_error(&e);
            0.0
        }
    };
    if paid_total > 0.0 {
        tracing::warn!(
            vendor = vendor_id,
            install_id_hash = %hash_prefix(install_id),
            paid_total,
            "fresh issuance found prior payment history with no local issuance row — \
             crediting it back; this usually means the broker's own record was lost"
        );
    }

    let expires_at = now + ChronoDuration::days(state.config.trial_key_expires_days);
    let spec = KeySpec {
        label: trial_key_label(install_id),
        limit_usd: policy.limit_amount
            + crate::topup::granted_for_payment(state.config.topup_price_markup, paid_total),
        reset: policy.reset,
        expires_at: Some(expires_at.to_rfc3339_opts(SecondsFormat::Secs, true)),
    };

    let issued = vendor.issue_key(spec).await.map_err(|e| {
        log_vendor_error(&e);
        AppError::UpstreamError("failed to issue upstream key".into())
    })?;

    // 5. Persist the issuance (never the plaintext key — only its hash, for
    // `crate::topup::usage_by_key`'s paste-your-key lookup).
    let issuance = Issuance {
        id: Uuid::new_v4().to_string(),
        vendor: vendor_id.to_string(),
        install_id: install_id.to_string(),
        ip: ip.to_string(),
        vendor_key_handle: issued.handle,
        issued_at: now_ms,
        expires_at: expires_at.timestamp_millis(),
        disabled: 0,
        key_hash: Some(hash_key(&issued.secret)),
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
    let client = vendor.client_config();
    Ok(TrialKeyResponse {
        key: issued.secret,
        base_url: client.base_url.to_string(),
        models: issued.models,
        platform: client.platform.to_string(),
        vendor: vendor_id.to_string(),
        currency: client.currency.to_string(),
    })
}

/// Handles a repeat `POST /v1/trial-keys` for an install that already holds
/// an issuance. Historically this was always a flat 409 — reasonable when
/// the key genuinely still worked, wrong when it does not: a real key can go
/// missing on the vendor's side for reasons entirely outside this install's
/// control (an operator cleanup, vendor-side abuse action, account issue),
/// and until now that install had no way back in at all.
///
/// Vendors that cannot answer "is this key still there" (`key_alive_models`
/// defaults to `Unsupported` — OpenRouter, today) fall straight through to
/// the original 409, unchanged. Only a vendor that actively implements
/// recovery (Baoyun) gets the smarter path.
async fn recover_or_reveal(
    state: &AppState,
    vendor: &dyn TokenVendor,
    vendor_id: &str,
    install_id: &str,
    ip: IpAddr,
    existing: &Issuance,
) -> Result<TrialKeyResponse, AppError> {
    match vendor.key_alive_models(&existing.vendor_key_handle).await {
        Ok(Some(models)) => {
            // The key is still there — this install's own local copy of the
            // plaintext (or provider row) is what went missing. No need to
            // mint anything new: just hand the same key back.
            let key = vendor
                .reveal_key(&existing.vendor_key_handle)
                .await
                .map_err(|e| {
                    log_vendor_error(&e);
                    AppError::UpstreamError("failed to re-reveal the existing key".into())
                })?;
            tracing::info!(
                vendor = vendor_id,
                install_id_hash = %hash_prefix(install_id),
                "repeat claim: key still alive, re-revealed its plaintext"
            );
            let client = vendor.client_config();
            Ok(TrialKeyResponse {
                key,
                base_url: client.base_url.to_string(),
                models,
                platform: client.platform.to_string(),
                vendor: vendor_id.to_string(),
                currency: client.currency.to_string(),
            })
        }
        Ok(None) => recover_deleted_key(state, vendor, vendor_id, install_id, ip, existing).await,
        Err(VendorError::Unsupported { .. }) => Err(AppError::AlreadyIssued),
        Err(e) => {
            log_vendor_error(&e);
            Err(AppError::UpstreamError(
                "failed to check the existing key's status".into(),
            ))
        }
    }
}

/// The vendor confirmed `existing`'s key is genuinely gone. Reissues a fresh
/// one, crediting back everything this install can *prove* it paid — read
/// from the vendor's own order history (`paid_total`), not this broker's
/// local bookkeeping, which is exactly the kind of thing that could be lost
/// right alongside the key. `issuances` is UNIQUE on (vendor, install_id), so
/// the existing row is updated in place to point at the new handle rather
/// than kept around disabled — see `db::replace_issuance_key`.
async fn recover_deleted_key(
    state: &AppState,
    vendor: &dyn TokenVendor,
    vendor_id: &str,
    install_id: &str,
    ip: IpAddr,
    existing: &Issuance,
) -> Result<TrialKeyResponse, AppError> {
    let policy = state.issuance_policy(vendor_id);
    let reference = crate::topup::reference_for(vendor_id, install_id);
    let paid_total = vendor.paid_total(&reference).await.map_err(|e| {
        log_vendor_error(&e);
        AppError::UpstreamError("failed to read this install's paid history".into())
    })?;

    let now = Utc::now();
    let now_ms = now.timestamp_millis();
    let expires_at = now + ChronoDuration::days(state.config.trial_key_expires_days);
    // `paid_total` is the raw CNY the user actually paid, straight from the
    // vendor's order history — it must go through the same resale-markup
    // conversion as a normal top-up (`crate::topup::credit_once`), or
    // recovery would silently hand back the platform's margin along with
    // the principal.
    let granted_from_paid =
        crate::topup::granted_for_payment(state.config.topup_price_markup, paid_total);
    let spec = KeySpec {
        label: trial_key_label(install_id),
        // Current free-grant policy plus everything this install proved it
        // paid (after markup) — never less than what a fresh claim would
        // get, and never silently short-changing a paying user just because
        // their key died.
        limit_usd: policy.limit_amount + granted_from_paid,
        reset: policy.reset,
        expires_at: Some(expires_at.to_rfc3339_opts(SecondsFormat::Secs, true)),
    };

    let issued = vendor.issue_key(spec).await.map_err(|e| {
        log_vendor_error(&e);
        AppError::UpstreamError("failed to issue a replacement upstream key".into())
    })?;

    // `issuances` is UNIQUE on (vendor, install_id) — there is only ever one
    // row for this install on this vendor, so recovery re-points it rather
    // than inserting a second one.
    db::replace_issuance_key(
        &state.pool,
        &existing.id,
        &issued.handle,
        now_ms,
        expires_at.timestamp_millis(),
        &hash_key(&issued.secret),
    )
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "failed to persist the recovered issuance");
        AppError::Internal("database error".into())
    })?;

    tracing::info!(
        vendor = vendor_id,
        install_id_hash = %hash_prefix(install_id),
        ip = %ip,
        paid_total,
        granted_from_paid,
        "recovered a deleted key by reissuing"
    );

    let client = vendor.client_config();
    Ok(TrialKeyResponse {
        key: issued.secret,
        base_url: client.base_url.to_string(),
        models: issued.models,
        platform: client.platform.to_string(),
        vendor: vendor_id.to_string(),
        currency: client.currency.to_string(),
    })
}

/// The `POST /v1/quota/status` flow: find this install's key, ask the vendor
/// where its spend stands.
///
/// Reads by the stored handle, so it never needs the plaintext key — the
/// client holds the only copy of that, and this stays true for the paid tier.
pub async fn read_quota_status(
    state: &AppState,
    vendor_id: &str,
    install_id: &str,
) -> Result<QuotaStatusResponse, AppError> {
    if install_id.trim().is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }

    let vendor = state
        .vendors
        .get(vendor_id)
        .ok_or(AppError::VendorUnknown)?;

    let issuance = db::find_active_by_install_id(&state.pool, vendor_id, install_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "db error during quota lookup");
            AppError::Internal("database error".into())
        })?
        // Not an error state worth its own code: the caller asked about a key
        // this service never issued. 404 says exactly that.
        .ok_or(AppError::NotIssued)?;

    let usage = vendor
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
        currency: usage.currency,
    })
}

/// Applies a top-up to this install's key on `vendor_id` and returns the
/// resulting quota. The install must already hold an active issuance — there
/// is nothing to top up otherwise.
pub async fn apply_top_up(
    state: &AppState,
    vendor_id: &str,
    install_id: &str,
    delta_amount: f64,
) -> Result<QuotaStatusResponse, AppError> {
    let vendor = state
        .vendors
        .get(vendor_id)
        .ok_or(AppError::VendorUnknown)?;

    let issuance = db::find_active_by_install_id(&state.pool, vendor_id, install_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "db error during top-up lookup");
            AppError::Internal("database error".into())
        })?
        .ok_or(AppError::NotIssued)?;

    let usage = vendor
        .top_up(&issuance.vendor_key_handle, delta_amount)
        .await
        .map_err(|e| {
            log_vendor_error(&e);
            AppError::UpstreamError("failed to top up upstream key".into())
        })?;

    tracing::info!(
        vendor = vendor_id,
        install_id_hash = %hash_prefix(install_id),
        delta = delta_amount,
        "applied top-up"
    );

    Ok(QuotaStatusResponse {
        vendor: vendor_id.to_string(),
        limit_usd: usage.limit_usd,
        used_usd: usage.used_usd,
        remaining_usd: usage.remaining_usd,
        reset: usage.reset.map(|r| r.as_str().to_string()),
        exhausted: usage.is_exhausted(),
        currency: usage.currency,
    })
}

/// A short, non-reversible-enough-to-matter prefix used only for log lines,
/// so we never log a raw install_id.
fn hash_prefix(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    digest[..4].iter().map(|b| format!("{b:02x}")).collect()
}

/// Full sha256 hex digest of a plaintext issued key — stored alongside
/// `Issuance` so the "paste your key, see your usage" query
/// (`crate::topup::usage_by_key`) can find the matching row without this
/// broker ever storing the plaintext itself. A vendor's `IssuedKey::secret`
/// is only ever available in the single `issue_key` call that mints it, so
/// this must be computed right there and persisted immediately — there is no
/// way to recover it later.
pub fn hash_key(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Baoyun key names are capped at 50 chars (verified against the live
/// `创建 Key` docs). `install_id` is normally `install_` + a UUID (44 chars),
/// so `trial-{install_id}` fits at exactly 50 — but this truncates
/// defensively rather than trusting that format holds forever, so a future
/// longer install_id can never produce an invalid create-key request.
/// Deliberately deterministic (no random suffix, unlike the old
/// `onework-trial-{short_uuid}` label): letting a recovered replacement key
/// reuse the same name is a feature, not a collision — an operator staring
/// at Baoyun's own console can recognize "same install" across a recovery
/// even though the key's underlying id changed.
fn trial_key_label(install_id: &str) -> String {
    const MAX_LEN: usize = 50;
    let label = format!("trial-{install_id}");
    if label.chars().count() > MAX_LEN {
        label.chars().take(MAX_LEN).collect()
    } else {
        label
    }
}

#[cfg(test)]
mod label_tests {
    use super::*;

    #[test]
    fn trial_key_label_is_deterministic_from_install_id() {
        assert_eq!(trial_key_label("install-abc"), "trial-install-abc");
        // Calling it again for the same install_id must produce the exact
        // same label — this is what lets a recovered key reuse the name.
        assert_eq!(trial_key_label("install-abc"), "trial-install-abc");
    }

    #[test]
    fn trial_key_label_fits_a_realistic_install_id_with_room_to_spare() {
        // `install_` + a 36-char UUID = 44 chars; `trial-` + that = 50,
        // exactly at the cap.
        let install_id = "install_01a04786-0f25-76b1-9744-3122152b8c04";
        let label = trial_key_label(install_id);
        assert_eq!(label, format!("trial-{install_id}"));
        assert_eq!(label.chars().count(), 50);
    }

    #[test]
    fn trial_key_label_truncates_rather_than_exceed_the_cap() {
        let very_long_install_id = "install_".to_string() + &"x".repeat(100);
        let label = trial_key_label(&very_long_install_id);
        assert_eq!(label.chars().count(), 50);
        assert!(label.starts_with("trial-install_"));
    }
}

#[cfg(test)]
mod hash_key_tests {
    use super::*;

    #[test]
    fn hash_key_is_deterministic() {
        assert_eq!(hash_key("sk-abc123"), hash_key("sk-abc123"));
    }

    #[test]
    fn hash_key_differs_for_different_keys() {
        assert_ne!(hash_key("sk-abc123"), hash_key("sk-abc124"));
    }

    #[test]
    fn hash_key_never_contains_the_plaintext() {
        let hash = hash_key("sk-super-secret-value");
        assert!(!hash.contains("sk-super-secret-value"));
        // sha256 hex digest is exactly 64 chars.
        assert_eq!(hash.len(), 64);
    }
}
