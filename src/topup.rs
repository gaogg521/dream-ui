//! Real-money top-up orders for mode A vendors that support them (Baoyun, so
//! far — see [`crate::vendor::TokenVendor::create_topup_order`]).
//!
//! The flow: create an order (the vendor returns a scan-to-pay QR), the
//! client polls this service's `GET` until the vendor reports `success`, and
//! on first observed success this credits the *paying install's own key* via
//! [`crate::vendor::TokenVendor::top_up`]. That last step is this broker's
//! job, not the vendor's — Baoyun's own top-up settles into the shared
//! account balance, with no notion of "this money is for that key". The only
//! thing tying an order back to an install is `reference`, an opaque string
//! this broker sets at creation and gets back unchanged on every later read;
//! [`get_topup_order`] refuses to report (let alone credit) an order whose
//! reference does not match the install asking about it.
//!
//! Core functions take `&AppState` and are HTTP-independent, same convention
//! as [`crate::service`] and [`crate::metered::service`].

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db;
use crate::error::AppError;
use crate::service::AppState;
use crate::vendor::{TokenVendor, TopupOrderSpec, TopupOrderStatus, VendorError};

#[derive(Debug, Serialize, PartialEq)]
pub struct TopupOrderResponse {
    pub id: String,
    pub vendor: String,
    /// `pending`, `success`, `failed`, or `expired`.
    pub status: String,
    pub currency: String,
    pub amount: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
}

/// Deterministic from `(vendor, install)`, not stored anywhere separately —
/// recomputed on every read and compared against what the vendor echoes back.
fn reference_for(vendor_id: &str, install_id: &str) -> String {
    format!("{vendor_id}:{install_id}")
}

fn map_vendor_error(e: VendorError) -> AppError {
    log_vendor_error(&e);
    match e {
        VendorError::Unsupported { .. } => AppError::TopupUnsupported,
        _ => AppError::UpstreamError("topup vendor call failed".into()),
    }
}

fn log_vendor_error(error: &VendorError) {
    match error {
        VendorError::Upstream {
            vendor,
            status,
            body,
        } => {
            tracing::error!(vendor, status, body = %body, "topup vendor call returned an error status");
        }
        VendorError::Request { vendor, message } => {
            tracing::error!(vendor, error = %message, "topup vendor call failed");
        }
        VendorError::Unsupported { vendor, operation } => {
            tracing::error!(
                vendor,
                operation,
                "vendor does not support this top-up operation"
            );
        }
    }
}

fn db_error(context: &'static str) -> impl Fn(sqlx::Error) -> AppError {
    move |e| {
        tracing::error!(error = %e, context, "topup db error");
        AppError::Internal("database error".into())
    }
}

/// Creates a real-money top-up order. The install must already hold an
/// active key on `vendor_id` — there is nothing to eventually credit
/// otherwise (same precondition `crate::service::apply_top_up` enforces for
/// the ops-only atomic top-up).
pub async fn create_topup_order(
    state: &AppState,
    vendor_id: &str,
    install_id: &str,
    amount: f64,
) -> Result<TopupOrderResponse, AppError> {
    let install_id = install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    // `<=` alone would let NaN through (every comparison against NaN is
    // false), so it needs its own check.
    if amount.is_nan() || amount <= 0.0 {
        return Err(AppError::BadRequest("amount must be positive".into()));
    }

    let vendor = state
        .vendors
        .get(vendor_id)
        .ok_or(AppError::VendorUnknown)?;

    db::find_active_by_install_id(&state.pool, vendor_id, install_id)
        .await
        .map_err(db_error("topup order account check"))?
        .ok_or(AppError::NotIssued)?;

    let spec = TopupOrderSpec {
        amount,
        reference: reference_for(vendor_id, install_id),
        idempotency_key: Uuid::new_v4().to_string(),
    };

    let order = vendor
        .create_topup_order(spec)
        .await
        .map_err(map_vendor_error)?;

    tracing::info!(
        vendor = vendor_id,
        order_id = %order.id,
        amount,
        "topup order created"
    );

    Ok(TopupOrderResponse {
        id: order.id,
        vendor: vendor_id.to_string(),
        status: order.status.as_str().to_string(),
        currency: order.currency,
        amount: order.amount,
        qr_code: order.qr_code,
        expires_at: order.expires_at,
        completed_at: order.completed_at,
    })
}

/// Polls one top-up order. On first observation of `success` (checked
/// against the local `topup_credits` guard, not the vendor — Baoyun has no
/// "have I told you about this already" flag of its own), credits the
/// polling install's key by the paid amount.
pub async fn get_topup_order(
    state: &AppState,
    vendor_id: &str,
    install_id: &str,
    order_id: &str,
) -> Result<TopupOrderResponse, AppError> {
    let install_id = install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }

    let vendor = state
        .vendors
        .get(vendor_id)
        .ok_or(AppError::VendorUnknown)?;

    let issuance = db::find_active_by_install_id(&state.pool, vendor_id, install_id)
        .await
        .map_err(db_error("topup order poll account check"))?
        .ok_or(AppError::NotIssued)?;

    let order = vendor
        .get_topup_order(order_id)
        .await
        .map_err(map_vendor_error)?;

    let expected_reference = reference_for(vendor_id, install_id);
    if order.reference.as_deref() != Some(expected_reference.as_str()) {
        // Deliberately not logged with the real reference/order id at `warn`
        // or above in a way that would help an attacker learn which orders
        // exist — this is exactly the "not found" a guesser should see.
        tracing::info!(
            vendor = vendor_id,
            order_id,
            "topup order reference mismatch"
        );
        return Err(AppError::TopupOrderMismatch);
    }

    if order.status == TopupOrderStatus::Success {
        credit_once(
            state,
            vendor.as_ref(),
            vendor_id,
            install_id,
            order_id,
            &issuance.vendor_key_handle,
            order.amount,
        )
        .await?;
    }

    Ok(TopupOrderResponse {
        id: order.id,
        vendor: vendor_id.to_string(),
        status: order.status.as_str().to_string(),
        currency: order.currency,
        amount: order.amount,
        qr_code: order.qr_code,
        expires_at: order.expires_at,
        completed_at: order.completed_at,
    })
}

/// Reserves `order_id` in `topup_credits` (single INSERT, `ON CONFLICT DO
/// NOTHING`) and, only if this call won that reservation, calls
/// [`TokenVendor::top_up`]. If the vendor call then fails, the reservation is
/// rolled back so the *next* poll retries the whole thing rather than
/// permanently reporting an order as settled that was never actually
/// credited to the key. Relies on the broker's pool being capped at one
/// connection (see `crate::db::init_pool`) to serialize concurrent pollers —
/// the same invariant `crate::metered::store` leans on for its own ledger.
async fn credit_once(
    state: &AppState,
    vendor: &dyn TokenVendor,
    vendor_id: &str,
    install_id: &str,
    order_id: &str,
    handle: &str,
    amount: f64,
) -> Result<(), AppError> {
    let inserted = sqlx::query(
        "INSERT INTO topup_credits (order_id, vendor, install_id, amount, credited_at) \
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    )
    .bind(order_id)
    .bind(vendor_id)
    .bind(install_id)
    .bind(amount)
    .bind(chrono::Utc::now().timestamp_millis())
    .execute(&state.pool)
    .await
    .map_err(db_error("record topup credit"))?
    .rows_affected()
        == 1;

    if !inserted {
        // Already credited by an earlier poll.
        return Ok(());
    }

    if let Err(e) = vendor.top_up(handle, amount).await {
        log_vendor_error(&e);
        // Undo the reservation so the next poll retries the credit instead
        // of silently reporting `success` with the key never actually
        // topped up. Safe without a transaction: the single-connection pool
        // means nothing else could have raced this row in between.
        if let Err(cleanup_err) = sqlx::query("DELETE FROM topup_credits WHERE order_id = ?")
            .bind(order_id)
            .execute(&state.pool)
            .await
        {
            tracing::error!(
                order_id,
                error = %cleanup_err,
                "failed to roll back a topup_credits reservation after a failed top_up — \
                 this order will read as permanently un-creditable until fixed by hand"
            );
        }
        return Err(AppError::UpstreamError(
            "failed to credit the top-up to the key".into(),
        ));
    }

    tracing::info!(vendor = vendor_id, order_id, amount, "topup order credited");
    Ok(())
}

/// One credited top-up, as `/internal/vendors/:vendor/topups` reports it —
/// the reconciliation view for "which end user did this real-money payment
/// belong to," since the vendor's own console shows the payment but not that
/// (see the handoff doc's §11.7 for why: Baoyun's wallet page has no column
/// for the `reference` this broker sets).
#[derive(Debug, Serialize)]
pub struct TopupCreditView {
    pub order_id: String,
    pub install_id: String,
    /// The vendor's own key id this credit landed on — cross-reference with
    /// that vendor's own key list/usage console to see the human-readable
    /// key name and subsequent spend. `None` only if the local issuance
    /// record is gone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_key_handle: Option<String>,
    pub amount: f64,
    /// Unix ms.
    pub credited_at: i64,
}

impl From<db::TopupCredit> for TopupCreditView {
    fn from(c: db::TopupCredit) -> Self {
        Self {
            order_id: c.order_id,
            install_id: c.install_id,
            vendor_key_handle: c.vendor_key_handle,
            amount: c.amount,
            credited_at: c.credited_at,
        }
    }
}

/// Lists credited real-money top-ups for `vendor_id`, newest first. Ops-only
/// — same trust tier as `/internal/stats`: reachable, not authenticated
/// beyond network placement, not advertised to the desktop client.
///
/// `order_id` filters to one order — for the "I'm staring at an unfamiliar
/// row in Baoyun's own wallet console, whose was it" direction (Baoyun
/// support confirmed their "交易号" column *is* this broker's order id).
/// `install_id` filters to one user's whole top-up history instead. Either,
/// both, or neither may be set.
pub async fn list_topups(
    state: &AppState,
    vendor_id: &str,
    install_id: Option<&str>,
    order_id: Option<&str>,
) -> Result<Vec<TopupCreditView>, AppError> {
    if !state.vendors.contains_key(vendor_id) {
        return Err(AppError::VendorUnknown);
    }
    let credits = db::list_topup_credits(&state.pool, vendor_id, install_id, order_id)
        .await
        .map_err(db_error("list topup credits"))?;
    Ok(credits.into_iter().map(TopupCreditView::from).collect())
}

// --- axum handlers -----------------------------------------------

#[derive(Debug, Deserialize)]
pub struct CreateTopupOrderRequest {
    pub vendor: String,
    pub install_id: String,
    pub amount: f64,
}

pub async fn create_topup_order_handler(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateTopupOrderRequest>,
) -> Result<Json<TopupOrderResponse>, AppError> {
    Ok(Json(
        create_topup_order(&state, &payload.vendor, &payload.install_id, payload.amount).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct GetTopupOrderQuery {
    pub vendor: String,
    pub install_id: String,
}

pub async fn get_topup_order_handler(
    State(state): State<Arc<AppState>>,
    Path(order_id): Path<String>,
    Query(query): Query<GetTopupOrderQuery>,
) -> Result<Json<TopupOrderResponse>, AppError> {
    Ok(Json(
        get_topup_order(&state, &query.vendor, &query.install_id, &order_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ListTopupsQuery {
    pub install_id: Option<String>,
    pub order_id: Option<String>,
}

pub async fn list_topups_handler(
    State(state): State<Arc<AppState>>,
    Path(vendor): Path<String>,
    Query(query): Query<ListTopupsQuery>,
) -> Result<Json<Vec<TopupCreditView>>, AppError> {
    Ok(Json(
        list_topups(
            &state,
            &vendor,
            query.install_id.as_deref(),
            query.order_id.as_deref(),
        )
        .await?,
    ))
}
