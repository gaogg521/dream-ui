use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, State};
use axum::http::HeaderMap;
use axum::routing::{any, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::db;
use crate::error::AppError;
use crate::metered::proxy::proxy_handler;
use crate::metered::service as metered;
use crate::service::{
    issue_trial_key, read_quota_status, AppState, QuotaStatusResponse, TrialKeyRequest,
    TrialKeyResponse,
};

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/trial-keys", post(create_trial_key))
        .route("/v1/quota/status", post(quota_status))
        // Mode B (metered proxy). The forwarding catch-all lives under its own
        // `/proxy/` segment so it never collides with these fixed routes.
        .route("/v1/metered/claim", post(metered::claim_handler))
        .route("/v1/metered/quota/status", post(metered::quota_handler))
        .route("/v1/metered/orders", post(metered::create_order_handler))
        .route("/v1/metered/orders/:id", get(metered::get_order_handler))
        .route(
            "/v1/metered/orders/webhook/:gateway",
            post(metered::webhook_handler),
        )
        .route("/v1/metered/proxy/:vendor/*path", any(proxy_handler))
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

#[derive(Debug, Deserialize)]
struct QuotaStatusRequest {
    install_id: String,
}

/// POST rather than GET so the install id travels in the body: it is a stable
/// per-device identifier, and a query string is the one place it would be
/// written to proxy and access logs on the way through.
async fn quota_status(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<QuotaStatusRequest>,
) -> Result<Json<QuotaStatusResponse>, AppError> {
    Ok(Json(read_quota_status(&state, &payload.install_id).await?))
}

async fn stats(State(state): State<Arc<AppState>>) -> Result<Json<serde_json::Value>, AppError> {
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

    // Liability *added today*, not spend incurred today: each key issued today
    // can spend up to `trial_key_limit_usd` per `limit_reset` period for as
    // long as it lives. Naming it "daily spend" would badly understate the
    // commitment under the default monthly reset.
    let liability_added_today_usd = issued_today as f64 * state.config.trial_key_limit_usd;

    Ok(Json(json!({
        "vendor": state.vendor.id(),
        "issued_today": issued_today,
        "issuance_budget_cap_usd": state.config.daily_budget_usd_cap,
        "liability_added_today_usd": liability_added_today_usd,
        "per_key_limit_usd": state.config.trial_key_limit_usd,
        "per_key_limit_reset": state.config.trial_key_limit_reset.as_str(),
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
