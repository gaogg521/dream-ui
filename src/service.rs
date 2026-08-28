use std::net::IpAddr;
use std::sync::Arc;

use chrono::{Duration as ChronoDuration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::config::{Config, DEFAULT_TRIAL_MODELS, OPENROUTER_BASE_URL};
use crate::db::{self, Issuance};
use crate::error::AppError;
use crate::openrouter::{CreateKeyRequest, OpenRouterClient, OpenRouterError};
use crate::rate_limit::RateLimiter;

#[derive(Debug, Deserialize)]
pub struct TrialKeyRequest {
    pub install_id: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct TrialKeyResponse {
    pub key: String,
    pub base_url: String,
    pub models: Vec<String>,
}

/// Shared application state handed to every request handler.
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub openrouter: Arc<dyn OpenRouterClient>,
    pub rate_limiter: Arc<RateLimiter>,
}

/// The full `POST /v1/trial-keys` flow: dedup -> rate limit -> circuit
/// breaker -> call OpenRouter -> persist -> respond. Kept independent of the
/// HTTP layer so it can be unit tested directly.
pub async fn issue_trial_key(
    state: &AppState,
    install_id: &str,
    ip: IpAddr,
) -> Result<TrialKeyResponse, AppError> {
    if install_id.trim().is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }

    // 1. Dedup by install_id.
    match db::find_active_by_install_id(&state.pool, install_id).await {
        Ok(Some(_)) => {
            tracing::info!(install_id_hash = %hash_prefix(install_id), "dedup rejection: install_id already issued");
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

    // 4. Call OpenRouter to mint the key.
    let expires_at = now + ChronoDuration::days(state.config.trial_key_expires_days);
    let request = CreateKeyRequest {
        name: format!("onework-trial-{}", short_uuid()),
        limit: state.config.trial_key_limit_usd,
        limit_reset: state.config.trial_key_limit_reset.clone(),
        expires_at: expires_at.to_rfc3339_opts(SecondsFormat::Secs, true),
    };

    let or_response = state
        .openrouter
        .create_key(request)
        .await
        .map_err(|e| {
            match &e {
                OpenRouterError::Upstream { status, body } => {
                    tracing::error!(status = status, body = %body, "openrouter create-key call returned an error status");
                }
                OpenRouterError::Request(msg) => {
                    tracing::error!(error = %msg, "openrouter create-key request failed");
                }
            }
            AppError::UpstreamError("failed to issue upstream key".into())
        })?;

    // 5. Persist the issuance (never store the plaintext key).
    let issuance = Issuance {
        id: Uuid::new_v4().to_string(),
        install_id: install_id.to_string(),
        ip: ip.to_string(),
        openrouter_key_hash: sha256_hex(&or_response.key),
        issued_at: now_ms,
        expires_at: expires_at.timestamp_millis(),
        disabled: 0,
    };

    db::insert_issuance(&state.pool, &issuance).await.map_err(|e| {
        tracing::error!(error = %e, "failed to persist issuance");
        AppError::Internal("database error".into())
    })?;

    tracing::info!(install_id_hash = %hash_prefix(install_id), "issued trial key");

    // 6. Respond.
    Ok(TrialKeyResponse {
        key: or_response.key,
        base_url: OPENROUTER_BASE_URL.to_string(),
        models: DEFAULT_TRIAL_MODELS.iter().map(|s| s.to_string()).collect(),
    })
}

/// A short, non-reversible-enough-to-matter prefix used only for log lines,
/// so we never log a raw install_id.
fn hash_prefix(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    digest[..4].iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn short_uuid() -> String {
    Uuid::new_v4().simple().to_string()[..8].to_string()
}
