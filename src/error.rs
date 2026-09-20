use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// All the ways `POST /v1/trial-keys` (and friends) can fail. Each variant
/// maps to exactly one HTTP status code and one stable `error` string in the
/// JSON body, so callers (e.g. dream-core) can match on it.
#[derive(Debug)]
pub enum AppError {
    /// install_id already has a non-disabled issuance on file. -> 409
    AlreadyIssued,
    /// Asked about a key this service never issued to that install. -> 404
    NotIssued,
    /// Caller's IP exceeded the configured per-hour request budget. -> 429
    RateLimited,
    /// Today's estimated liability from active issuances has hit the cap. -> 503
    BudgetExhausted,
    /// OpenRouter's key-creation call failed or returned a non-2xx. -> 502
    UpstreamError(String),
    /// Anything else (bad input, DB error, etc). -> 500 / 400
    Internal(String),
    BadRequest(String),
    /// `/v1/trial-keys` (or friends) named a vendor this broker has no
    /// [`crate::vendor::TokenVendor`] configured for. -> 404
    VendorUnknown,

    // --- mode B (metered proxy) ---
    /// `/v1/metered/*` named a vendor that is not configured. -> 404
    MeteredVendorUnknown,
    /// The install has never claimed a metered account on this vendor. -> 404
    MeteredAccountUnknown,
    /// The requested top-up package id is not offered. -> 400
    MeteredPackageUnknown,
    /// `/v1/metered/orders/{id}` for an order this service never created. -> 404
    MeteredOrderUnknown,
    /// A payment gateway callback failed verification. -> 400
    WebhookRejected(String),

    // --- mode C (hosted search) ---
    /// This broker has no search key configured, so `/v1/search` cannot run.
    /// 503 rather than 404: the route exists, the capability is switched off,
    /// and a client that falls back to "ask the user for their own key" needs
    /// to tell those two apart. -> 503
    SearchUnavailable,
    /// This install has used its whole allowance for the UTC day. -> 429
    SearchQuotaExhausted,
    /// Every install together has spent the day's cap. -> 503
    SearchBudgetExhausted,
}

impl AppError {
    pub fn status_code(&self) -> StatusCode {
        match self {
            AppError::AlreadyIssued => StatusCode::CONFLICT,
            AppError::NotIssued => StatusCode::NOT_FOUND,
            AppError::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            AppError::BudgetExhausted => StatusCode::SERVICE_UNAVAILABLE,
            AppError::UpstreamError(_) => StatusCode::BAD_GATEWAY,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            AppError::VendorUnknown => StatusCode::NOT_FOUND,
            AppError::MeteredVendorUnknown => StatusCode::NOT_FOUND,
            AppError::MeteredAccountUnknown => StatusCode::NOT_FOUND,
            AppError::MeteredPackageUnknown => StatusCode::BAD_REQUEST,
            AppError::MeteredOrderUnknown => StatusCode::NOT_FOUND,
            AppError::WebhookRejected(_) => StatusCode::BAD_REQUEST,
            AppError::SearchUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            AppError::SearchQuotaExhausted => StatusCode::TOO_MANY_REQUESTS,
            AppError::SearchBudgetExhausted => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    pub fn error_code(&self) -> &'static str {
        match self {
            AppError::AlreadyIssued => "already_issued",
            AppError::NotIssued => "not_issued",
            AppError::RateLimited => "rate_limited",
            AppError::BudgetExhausted => "daily_budget_exhausted",
            AppError::UpstreamError(_) => "upstream_error",
            AppError::BadRequest(_) => "bad_request",
            AppError::Internal(_) => "internal_error",
            AppError::VendorUnknown => "vendor_unknown",
            AppError::MeteredVendorUnknown => "metered_vendor_unknown",
            AppError::MeteredAccountUnknown => "metered_account_unknown",
            AppError::MeteredPackageUnknown => "metered_package_unknown",
            AppError::MeteredOrderUnknown => "metered_order_unknown",
            AppError::WebhookRejected(_) => "webhook_rejected",
            AppError::SearchUnavailable => "search_unavailable",
            AppError::SearchQuotaExhausted => "search_quota_exhausted",
            AppError::SearchBudgetExhausted => "search_budget_exhausted",
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} ({})", self.error_code(), self.status_code())
    }
}

impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = Json(json!({ "error": self.error_code() }));
        (status, body).into_response()
    }
}
