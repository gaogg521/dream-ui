//! Mode-B request flows: claim, quota, orders, webhook.
//!
//! Each core function takes `&AppState` and is HTTP-independent so it can be
//! unit tested directly, mirroring [`crate::service`]. The thin axum handlers
//! at the bottom are what `routes.rs` registers.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::store::{self, CreditOutcome};
use super::{new_device_token, now_ms, sha256_hex, MeteredError, OrderView};
use crate::error::AppError;
use crate::service::AppState;

// --- claim --------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct ClaimRequest {
    pub vendor: String,
    pub install_id: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ClaimResponse {
    pub vendor: String,
    /// The broker's own proxy address for this vendor — what the client sets
    /// as its provider `base_url`. Not the upstream vendor URL.
    pub base_url: String,
    /// Plaintext device token, returned exactly once. Used as the bearer on
    /// proxied calls. Rotates on every claim.
    pub device_token: String,
    pub models: Vec<String>,
    pub currency: String,
    pub free_grant_cents: i64,
    pub remaining_cents: i64,
}

pub async fn claim(
    state: &AppState,
    vendor: &str,
    install_id: &str,
) -> Result<ClaimResponse, AppError> {
    let install_id = install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    let config = state
        .metered
        .config(vendor)
        .ok_or(AppError::MeteredVendorUnknown)?;

    let device_token = new_device_token();
    let result = store::claim(
        &state.pool,
        vendor,
        install_id,
        &sha256_hex(&device_token),
        config.free_grant_cents,
        now_ms(),
    )
    .await
    .map_err(db_error("metered claim"))?;

    let account = store::get_account(&state.pool, vendor, install_id)
        .await
        .map_err(db_error("metered claim readback"))?
        .ok_or_else(|| AppError::Internal("account vanished immediately after claim".into()))?;

    tracing::info!(
        vendor,
        fresh_grant = result.fresh_grant,
        "metered account claimed"
    );

    Ok(ClaimResponse {
        vendor: vendor.to_string(),
        base_url: format!(
            "{}/v1/metered/proxy/{}",
            state.config.public_base_url, vendor
        ),
        device_token,
        models: config.models.clone(),
        currency: config.currency.to_string(),
        free_grant_cents: config.free_grant_cents,
        remaining_cents: account.remaining_cents(),
    })
}

// --- quota status ------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct QuotaRequest {
    pub vendor: String,
    pub install_id: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct QuotaResponse {
    pub vendor: String,
    pub currency: String,
    pub free_grant_cents: i64,
    pub purchased_cents: i64,
    pub consumed_cents: i64,
    pub remaining_cents: i64,
    pub exhausted: bool,
}

pub async fn quota_status(
    state: &AppState,
    vendor: &str,
    install_id: &str,
) -> Result<QuotaResponse, AppError> {
    let install_id = install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    let config = state
        .metered
        .config(vendor)
        .ok_or(AppError::MeteredVendorUnknown)?;

    let account = store::get_account(&state.pool, vendor, install_id)
        .await
        .map_err(db_error("metered quota"))?
        .ok_or(AppError::MeteredAccountUnknown)?;

    let remaining = account.remaining_cents();
    Ok(QuotaResponse {
        vendor: vendor.to_string(),
        currency: config.currency.to_string(),
        free_grant_cents: account.free_grant_cents,
        purchased_cents: account.purchased_cents,
        consumed_cents: account.consumed_cents,
        remaining_cents: remaining,
        exhausted: remaining <= 0,
    })
}

// --- orders -----------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateOrderRequest {
    pub vendor: String,
    pub install_id: String,
    pub package_id: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct OrderResponse {
    pub id: String,
    pub vendor: String,
    pub package_id: String,
    pub amount_cents: i64,
    pub credit_cents: i64,
    pub currency: String,
    pub status: String,
    pub gateway: String,
    /// The gateway's pay instructions (QR / redirect / mock marker). Present
    /// only on the create response, not on later status polls.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment: Option<Value>,
}

pub async fn create_order(
    state: &AppState,
    vendor: &str,
    install_id: &str,
    package_id: &str,
) -> Result<OrderResponse, AppError> {
    let install_id = install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    let config = state
        .metered
        .config(vendor)
        .ok_or(AppError::MeteredVendorUnknown)?;
    let package = config
        .package(package_id)
        .ok_or(AppError::MeteredPackageUnknown)?;

    // An order only makes sense against a claimed account.
    store::get_account(&state.pool, vendor, install_id)
        .await
        .map_err(db_error("order account check"))?
        .ok_or(AppError::MeteredAccountUnknown)?;

    let gateway = state.metered.gateway.as_ref();
    let order_id = Uuid::new_v4().to_string();

    store::create_order(
        &state.pool,
        &order_id,
        vendor,
        install_id,
        package.id,
        package.price_cents,
        package.credit_cents,
        gateway.id(),
        now_ms(),
    )
    .await
    .map_err(db_error("create order"))?;

    let intent = gateway
        .precreate(OrderView {
            id: &order_id,
            vendor,
            package_id: package.id,
            amount_cents: package.price_cents,
        })
        .await
        .map_err(metered_error("gateway precreate"))?;

    store::set_order_gateway_txn(&state.pool, &order_id, &intent.gateway_txn_id)
        .await
        .map_err(db_error("set gateway txn"))?;

    tracing::info!(
        vendor,
        order_id,
        package = package.id,
        "top-up order created"
    );

    Ok(OrderResponse {
        id: order_id,
        vendor: vendor.to_string(),
        package_id: package.id.to_string(),
        amount_cents: package.price_cents,
        credit_cents: package.credit_cents,
        currency: config.currency.to_string(),
        status: "pending".to_string(),
        gateway: gateway.id().to_string(),
        payment: Some(intent.payload),
    })
}

pub async fn get_order(state: &AppState, order_id: &str) -> Result<OrderResponse, AppError> {
    let order = store::get_order(&state.pool, order_id)
        .await
        .map_err(db_error("get order"))?
        .ok_or(AppError::MeteredOrderUnknown)?;

    let currency = state
        .metered
        .config(&order.vendor)
        .map(|c| c.currency.to_string())
        .unwrap_or_default();

    Ok(OrderResponse {
        id: order.id,
        vendor: order.vendor,
        package_id: order.package_id,
        amount_cents: order.amount_cents,
        credit_cents: order.credit_cents,
        currency,
        status: order.status,
        gateway: order.gateway,
        payment: None,
    })
}

// --- webhook --------------------------------------------------------

pub async fn handle_webhook(
    state: &AppState,
    gateway_name: &str,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<Value, AppError> {
    if gateway_name != state.metered.gateway.id() {
        return Err(AppError::MeteredVendorUnknown);
    }

    let outcome = state
        .metered
        .gateway
        .verify_webhook(headers, body)
        .await
        .map_err(|e| match e {
            MeteredError::WebhookRejected(m) => AppError::WebhookRejected(m),
            other => {
                tracing::error!(error = %other, "webhook verification errored");
                AppError::Internal("webhook verification failed".into())
            }
        })?;

    if !outcome.paid {
        tracing::info!(order_id = %outcome.order_id, "webhook says not paid; acknowledged");
        return Ok(json!({ "ok": true, "paid": false }));
    }

    match store::mark_order_paid_and_credit(
        &state.pool,
        &outcome.order_id,
        outcome.gateway_txn_id.as_deref(),
        now_ms(),
    )
    .await
    .map_err(db_error("credit order"))?
    {
        CreditOutcome::Credited { credit_cents } => {
            tracing::info!(order_id = %outcome.order_id, credit_cents, "order paid and credited");
            Ok(json!({ "ok": true, "paid": true, "credited_cents": credit_cents }))
        }
        CreditOutcome::AlreadySettled => {
            Ok(json!({ "ok": true, "paid": true, "credited_cents": 0 }))
        }
        CreditOutcome::UnknownOrder => Err(AppError::MeteredOrderUnknown),
    }
}

// --- helpers -------------------------------------------------------

fn db_error(context: &'static str) -> impl Fn(sqlx::Error) -> AppError {
    move |e| {
        tracing::error!(error = %e, context, "metered db error");
        AppError::Internal("database error".into())
    }
}

fn metered_error(context: &'static str) -> impl Fn(MeteredError) -> AppError {
    move |e| {
        tracing::error!(error = %e, context, "metered vendor/gateway error");
        AppError::UpstreamError("metered operation failed".into())
    }
}

// --- axum handlers -----------------------------------------------

pub async fn claim_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ClaimRequest>,
) -> Result<Json<ClaimResponse>, AppError> {
    Ok(Json(
        claim(&state, &payload.vendor, &payload.install_id).await?,
    ))
}

pub async fn quota_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<QuotaRequest>,
) -> Result<Json<QuotaResponse>, AppError> {
    Ok(Json(
        quota_status(&state, &payload.vendor, &payload.install_id).await?,
    ))
}

pub async fn create_order_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateOrderRequest>,
) -> Result<Json<OrderResponse>, AppError> {
    Ok(Json(
        create_order(
            &state,
            &payload.vendor,
            &payload.install_id,
            &payload.package_id,
        )
        .await?,
    ))
}

pub async fn get_order_handler(
    State(state): State<Arc<AppState>>,
    Path(order_id): Path<String>,
) -> Result<Json<OrderResponse>, AppError> {
    Ok(Json(get_order(&state, &order_id).await?))
}

pub async fn webhook_handler(
    State(state): State<Arc<AppState>>,
    Path(gateway): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        handle_webhook(&state, &gateway, &headers, &body).await?,
    ))
}
