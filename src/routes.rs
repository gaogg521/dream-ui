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
    apply_top_up, issue_trial_key, read_quota_status, AppState, QuotaStatusResponse,
    TrialKeyRequest, TrialKeyResponse,
};
use crate::topup;

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/trial-keys", post(create_trial_key))
        .route("/v1/quota/status", post(quota_status))
        // Real-money top-up (mode A vendors that support it — see
        // TokenVendor::create_topup_order). Literal `/orders` before
        // `/orders/:id` for the same reason mode B's order routes are
        // ordered this way.
        .route("/v1/topup/orders", post(topup::create_topup_order_handler))
        .route("/v1/topup/orders/:id", get(topup::get_topup_order_handler))
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
        // Mode C (hosted search). No vendor segment: one provider, chosen by
        // the broker, so the client never names it.
        .route("/v1/search", post(crate::search::service::search_handler))
        .route("/internal/stats", get(stats))
        // Ops-only: apply a top-up to a mode A key. No client (dream-ui) calls
        // this yet — there is no end-user payment collection wired up for
        // either vendor — but the capability itself is real, not a stub: a
        // future payment webhook, or an operator by hand, can drive it today.
        // Same trust tier as `/internal/stats`: reachable, not authenticated
        // beyond network placement, not advertised to the desktop client.
        .route(
            "/internal/vendors/:vendor/trial-keys/:install_id/topup",
            post(internal_top_up),
        )
        // Ops-only reconciliation view: which install a credited real-money
        // top-up belonged to. Exists because the vendor's own payment
        // console (Baoyun's included) has no column for the `reference` this
        // broker sets — see docs/baoyun-metered-proxy-handoff.zh-CN.md §11.7.
        .route(
            "/internal/vendors/:vendor/topups",
            get(topup::list_topups_handler),
        )
        // Ops-only: this install's real per-call usage history, straight
        // from the vendor's own logs (Baoyun's `GET /apis/v1/logs`) — for
        // support/reconciliation ("what did this user actually run, what did
        // it really cost") without needing the vendor's own console at all.
        .route(
            "/internal/vendors/:vendor/usage/:install_id",
            get(topup::usage_history_handler),
        )
        .with_state(state)
}

async fn create_trial_key(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<TrialKeyRequest>,
) -> Result<Json<TrialKeyResponse>, AppError> {
    let ip = extract_client_ip(&headers, addr);
    let response = issue_trial_key(&state, &payload.vendor, &payload.install_id, ip).await?;
    Ok(Json(response))
}

#[derive(Debug, Deserialize)]
struct QuotaStatusRequest {
    vendor: String,
    install_id: String,
}

/// POST rather than GET so the install id travels in the body: it is a stable
/// per-device identifier, and a query string is the one place it would be
/// written to proxy and access logs on the way through.
async fn quota_status(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<QuotaStatusRequest>,
) -> Result<Json<QuotaStatusResponse>, AppError> {
    Ok(Json(
        read_quota_status(&state, &payload.vendor, &payload.install_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct TopUpRequest {
    /// Positive to credit, negative to deduct. Amount is in the vendor's own
    /// currency (see `TrialKeyResponse.currency` / `QuotaStatusResponse.currency`
    /// for which one that is).
    amount: f64,
}

async fn internal_top_up(
    State(state): State<Arc<AppState>>,
    axum::extract::Path((vendor, install_id)): axum::extract::Path<(String, String)>,
    Json(payload): Json<TopUpRequest>,
) -> Result<Json<QuotaStatusResponse>, AppError> {
    Ok(Json(
        apply_top_up(&state, &vendor, &install_id, payload.amount).await?,
    ))
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

    // Mode A: one entry per configured vendor. Liability *added today*, not
    // spend incurred today — each key issued today can spend up to its
    // vendor's per-key limit for as long as it lives, so naming it "daily
    // spend" would badly understate the commitment under a renewing reset.
    let mut vendor_stats = Vec::with_capacity(state.vendors.len());
    for vendor_id in state.vendors.keys() {
        let issued_today = db::count_active_issued_since(
            &state.pool,
            vendor_id,
            today_start_ms,
            now_ms,
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, vendor = *vendor_id, "db error while computing stats");
            AppError::Internal("database error".into())
        })?;
        let policy = state.issuance_policy(vendor_id);
        vendor_stats.push(json!({
            "vendor": vendor_id,
            "issued_today": issued_today,
            "liability_added_today": issued_today as f64 * policy.limit_amount,
            "per_key_limit": policy.limit_amount,
            "per_key_limit_reset": policy.reset.as_str(),
            "daily_budget_cap": policy.daily_budget_cap,
        }));
    }

    // Which vendor mode C is spending, and how much of its allowance is left.
    // The handover from a free plan to a paid one is invisible from outside,
    // and this is the only place it can be watched before the bill arrives.
    let month = now.format("%Y-%m").to_string();
    let search_usage = crate::search::store::provider_usage_for_month(&state.pool, &month)
        .await
        .unwrap_or_default();
    let search_providers: Vec<serde_json::Value> = state
        .search
        .providers
        .iter()
        .map(|provider| {
            let used = search_usage
                .iter()
                .find(|(id, _)| id == provider.id())
                .map(|(_, count)| *count)
                .unwrap_or(0);
            json!({
                "provider": provider.id(),
                "used_this_month": used,
                "monthly_cap": provider.monthly_cap(),
                "exhausted": provider.monthly_cap().is_some_and(|cap| used >= cap),
            })
        })
        .collect();

    Ok(Json(json!({
        "vendors": vendor_stats,
        "search_month": month,
        "search_providers": search_providers,
    })))
}

/// Trust boundary: this service sits behind our nginx reverse proxy, which is
/// configured to set `X-Real-IP` from `$remote_addr` — the TCP peer address
/// nginx itself observed on the connection, which a client cannot influence
/// through any request header of its own. That is the only header we trust
/// for the caller's real IP, and it feeds the per-IP rate limiters
/// (`PER_IP_RATE_LIMIT_PER_HOUR`, `SEARCH_RATE_LIMIT_PER_HOUR`).
///
/// We deliberately do **not** read `X-Forwarded-For`: nginx is configured to
/// *append* to it (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`),
/// not to overwrite it, so a client can send its own `X-Forwarded-For` header
/// with an arbitrary address and have that value land in the left-most
/// ("original client") position — which is exactly what naive XFF parsing
/// picks. Trusting that header let any caller forge a different IP on every
/// request and bypass the rate limiter entirely. Never resurrect trust in a
/// client-supplied `X-Forwarded-For` here.
///
/// Falls back to the TCP peer address from `ConnectInfo` when `X-Real-IP` is
/// absent or fails to parse — e.g. running locally without the reverse proxy
/// in front, or in tests. That fallback is still safe: `ConnectInfo` comes
/// from the actual accepted socket, not from a header.
pub(crate) fn extract_client_ip(headers: &HeaderMap, peer: SocketAddr) -> std::net::IpAddr {
    if let Some(ip) = headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse().ok())
    {
        return ip;
    }
    peer.ip()
}

#[cfg(test)]
mod extract_client_ip_tests {
    use super::extract_client_ip;
    use axum::http::HeaderMap;
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    fn peer(ip: [u8; 4], port: u16) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::from(ip), port))
    }

    #[test]
    fn uses_x_real_ip_set_by_nginx() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "203.0.113.9".parse().unwrap());
        let ip = extract_client_ip(&headers, peer([10, 0, 0, 1], 1234));
        assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 9)));
    }

    #[test]
    fn ignores_spoofed_x_forwarded_for_even_without_x_real_ip() {
        // A malicious client sends its own X-Forwarded-For, hoping the
        // left-most, attacker-chosen address gets treated as the real IP so
        // it can dodge the per-IP rate limiter on every request. It must be
        // ignored entirely; only the real TCP peer address counts here.
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "1.2.3.4, 5.6.7.8".parse().unwrap());
        let ip = extract_client_ip(&headers, peer([192, 168, 0, 42], 5555));
        assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(192, 168, 0, 42)));
    }

    #[test]
    fn x_real_ip_wins_even_when_client_also_forges_x_forwarded_for() {
        // nginx sets X-Real-IP itself from $remote_addr, so even if the
        // client also sends a forged X-Forwarded-For in the same request,
        // the trustworthy header must be the one that decides.
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "198.51.100.7".parse().unwrap());
        headers.insert("x-forwarded-for", "6.6.6.6".parse().unwrap());
        let ip = extract_client_ip(&headers, peer([10, 0, 0, 1], 1234));
        assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(198, 51, 100, 7)));
    }

    #[test]
    fn falls_back_to_peer_when_x_real_ip_missing() {
        let headers = HeaderMap::new();
        let ip = extract_client_ip(&headers, peer([172, 16, 0, 5], 9999));
        assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(172, 16, 0, 5)));
    }

    #[test]
    fn falls_back_to_peer_when_x_real_ip_unparsable() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", "not-an-ip".parse().unwrap());
        let ip = extract_client_ip(&headers, peer([172, 16, 0, 9], 9999));
        assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(172, 16, 0, 9)));
    }
}
