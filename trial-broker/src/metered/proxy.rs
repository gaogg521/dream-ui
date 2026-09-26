//! The forwarding path: `ANY /v1/metered/proxy/{vendor}/*path`.
//!
//! Auth is the device token from claim, as a bearer. The broker checks the
//! local balance (hard-blocks at zero — the product decision is no fallback to
//! a free pool), swaps in the vendor master key, streams the upstream response
//! straight back, and bills the call afterwards from the vendor's own figure.
//!
//! Under a distinct `/proxy/` segment so the catch-all never collides with the
//! fixed metered routes (`/claim`, `/orders/{id}`, ...).

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use super::{now_ms, sha256_hex, store, CostOutcome, ProxiedCall};
use crate::service::AppState;

/// Response header carrying the vendor's per-call id (Baoyun's spelling).
const REQUEST_ID_HEADER: &str = "x-aihub-request-id";
/// Best-effort: async task id, when the vendor puts one in a header.
const TASK_ID_HEADER: &str = "x-aihub-task-id";

/// Cap on a forwarded request body. Inference payloads are prompts, not
/// uploads; anything larger is refused rather than buffered.
const MAX_REQUEST_BODY: usize = 10 * 1024 * 1024;

/// How long to wait before the first cost query, giving a synchronous call
/// time to settle upstream.
const BILL_INITIAL_DELAY: Duration = Duration::from_millis(1_500);
/// Backoff before the poller's next look at a still-unsettled cost.
pub(crate) const PENDING_RETRY_MS: i64 = 30_000;

/// Headers never copied toward the upstream: hop-by-hop (RFC 7230 §6.1), plus
/// the ones the proxy sets or the transport owns.
fn drop_on_request(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "host"
            | "authorization"
            | "content-length"
    )
}

/// Headers never copied back to the client: hop-by-hop, plus `content-length`
/// since the body is re-streamed and its length is no longer known.
fn drop_on_response(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
            | "content-length"
    )
}

pub async fn proxy_handler(
    State(state): State<Arc<AppState>>,
    Path((vendor, path)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> Response {
    match forward(
        &state,
        &vendor,
        &path,
        query.as_deref(),
        method,
        &headers,
        body,
    )
    .await
    {
        Ok(resp) => resp,
        Err(resp) => resp,
    }
}

async fn forward(
    state: &Arc<AppState>,
    vendor: &str,
    path: &str,
    query: Option<&str>,
    method: Method,
    headers: &HeaderMap,
    body: Body,
) -> Result<Response, Response> {
    let Some(config) = state.metered.config(vendor) else {
        return Err(error_response(
            StatusCode::NOT_FOUND,
            "unknown_vendor",
            "no metered vendor with that id is configured",
            None,
        ));
    };

    // --- authenticate the device token -----------------------------------
    let token = bearer_token(headers).ok_or_else(|| {
        error_response(
            StatusCode::UNAUTHORIZED,
            "missing_token",
            "a device token bearer is required",
            None,
        )
    })?;

    let account = store::find_account_by_token(&state.pool, vendor, &sha256_hex(token))
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "db error resolving device token");
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                "database error",
                None,
            )
        })?
        .ok_or_else(|| {
            error_response(
                StatusCode::UNAUTHORIZED,
                "unknown_token",
                "device token not recognised",
                None,
            )
        })?;

    // --- hard block at zero balance ------------------------------------
    let remaining = account.remaining_cents();
    if remaining <= 0 {
        return Err(quota_exhausted_response(vendor, config.currency, remaining));
    }

    // --- build the upstream request ----------------------------------
    let url = match query {
        Some(q) if !q.is_empty() => format!("{}/{}?{}", config.base_url, path, q),
        _ => format!("{}/{}", config.base_url, path),
    };

    let body_bytes = axum::body::to_bytes(body, MAX_REQUEST_BODY)
        .await
        .map_err(|_| {
            error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "body_too_large",
                "request body exceeds the forwarding limit",
                None,
            )
        })?;

    let mut upstream_headers = HeaderMap::new();
    for (name, value) in headers {
        if drop_on_request(name) {
            continue;
        }
        upstream_headers.append(name.clone(), value.clone());
    }
    upstream_headers.insert(
        header::AUTHORIZATION,
        HeaderValue::try_from(format!("Bearer {}", config.master_api_key))
            .expect("master key is header-safe"),
    );

    let upstream = state
        .metered
        .http
        .request(method, &url)
        .headers(upstream_headers)
        .body(body_bytes)
        .send()
        .await
        .map_err(|e| {
            tracing::error!(error = %e, vendor, "upstream forward failed");
            error_response(
                StatusCode::BAD_GATEWAY,
                "upstream_error",
                "the upstream vendor could not be reached",
                None,
            )
        })?;

    // --- schedule billing from the vendor's own figure ----------------
    let status = upstream.status();
    let request_id = header_str(upstream.headers(), REQUEST_ID_HEADER);
    let task_id = header_str(upstream.headers(), TASK_ID_HEADER);

    if let Some(request_id) = request_id {
        // A failed upstream call still gets a request id; billing it is
        // correct only if the vendor charged for it, and `GET /billing/cost`
        // is the authority on that — it will report 0 / not-found for a
        // request that cost nothing.
        spawn_billing(
            Arc::clone(state),
            vendor.to_string(),
            account.install_id.clone(),
            request_id,
            task_id,
        );
    } else if status.is_success() {
        tracing::warn!(
            vendor,
            %status,
            "upstream success carried no {REQUEST_ID_HEADER}; this call cannot be billed"
        );
    }

    // --- stream the response back ------------------------------------
    let mut response = Response::builder().status(status);
    for (name, value) in upstream.headers() {
        if drop_on_response(name) {
            continue;
        }
        response = response.header(name, value);
    }

    Ok(response
        .body(Body::from_stream(upstream.bytes_stream()))
        .expect("response is well formed"))
}

/// Runs the cost query off the request path so a slow (or retrying) billing
/// call never delays the caller's stream.
fn spawn_billing(
    state: Arc<AppState>,
    vendor: String,
    install_id: String,
    request_id: String,
    task_id: Option<String>,
) {
    tokio::spawn(async move {
        tokio::time::sleep(BILL_INITIAL_DELAY).await;

        let Some(resolver) = state.metered.resolver(&vendor).cloned() else {
            return;
        };
        let call = ProxiedCall {
            request_id: request_id.clone(),
            task_id: task_id.clone(),
        };

        match resolver.resolve(&call).await {
            Ok(CostOutcome::Settled(cents)) => {
                if let Err(e) = store::apply_consume(
                    &state.pool,
                    &vendor,
                    &install_id,
                    &request_id,
                    cents,
                    now_ms(),
                )
                .await
                {
                    tracing::error!(error = %e, request_id, "failed to record consume");
                }
            }
            Ok(CostOutcome::Pending) => {
                enqueue(
                    &state,
                    &vendor,
                    &install_id,
                    &request_id,
                    task_id.as_deref(),
                )
                .await;
            }
            Err(e) => {
                tracing::warn!(error = %e, request_id, "cost resolve failed; queueing for retry");
                enqueue(
                    &state,
                    &vendor,
                    &install_id,
                    &request_id,
                    task_id.as_deref(),
                )
                .await;
            }
        }
    });
}

async fn enqueue(
    state: &AppState,
    vendor: &str,
    install_id: &str,
    request_id: &str,
    task_id: Option<&str>,
) {
    let now = now_ms();
    if let Err(e) = store::enqueue_pending(
        &state.pool,
        vendor,
        install_id,
        request_id,
        task_id,
        now,
        now + PENDING_RETRY_MS,
    )
    .await
    {
        tracing::error!(error = %e, request_id, "failed to enqueue pending cost — charge may be lost");
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

fn header_str(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

fn error_response(
    status: StatusCode,
    code: &str,
    message: &str,
    extra: Option<serde_json::Value>,
) -> Response {
    let mut body = json!({ "error": code, "message": message });
    if let Some(serde_json::Value::Object(map)) = extra {
        if let serde_json::Value::Object(base) = &mut body {
            base.extend(map);
        }
    }
    (status, Json(body)).into_response()
}

/// The structured 402 the client keys its top-up prompt off. `code` is stable;
/// dream-core maps it straight to `UserLlmProviderQuotaExhausted` without
/// sniffing any upstream text (handoff doc §4).
fn quota_exhausted_response(vendor: &str, currency: &str, remaining_cents: i64) -> Response {
    error_response(
        StatusCode::PAYMENT_REQUIRED,
        "quota_exhausted",
        "the trial allowance for this vendor is spent",
        Some(json!({
            "code": "QUOTA_EXHAUSTED",
            "vendor": vendor,
            "currency": currency,
            "remaining_cents": remaining_cents,
        })),
    )
}
