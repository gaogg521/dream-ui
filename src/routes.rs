use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;

use crate::db;
use crate::error::AppError;
use crate::service::{issue_trial_key, AppState, TrialKeyRequest, TrialKeyResponse};

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/trial-keys", post(create_trial_key))
        .route("/internal/stats", get(stats))
        .with_state(state)
}

async fn create_trial_key(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<TrialKeyRequest>,
) -> Result<Json<TrialKeyResponse>, AppError> {
    let ip = extract_client_ip(&headers, addr);
    let response = issue_trial_key(&state, &payload.install_id, ip).await?;
    Ok(Json(response))
}

async fn stats(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, AppError> {
    let now = chrono::Utc::now();
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
            tracing::error!(error = %e, "db error while computing stats");
            AppError::Internal("database error".into())
        })?;

    let estimated_daily_liability_usd = issued_today as f64 * state.config.trial_key_limit_usd;

    Ok(Json(json!({
        "issued_today": issued_today,
        "budget_cap_usd": state.config.daily_budget_usd_cap,
        "estimated_daily_liability_usd": estimated_daily_liability_usd,
    })))
}

/// Trust boundary: this service is expected to sit behind a reverse proxy
/// that sets X-Forwarded-For; if present we take the first (left-most,
/// i.e. original client) address from it, otherwise we fall back to the
/// TCP peer address.
fn extract_client_ip(headers: &HeaderMap, peer: SocketAddr) -> std::net::IpAddr {
    if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = value.split(',').next() {
            if let Ok(ip) = first.trim().parse() {
                return ip;
            }
        }
    }
    peer.ip()
}
