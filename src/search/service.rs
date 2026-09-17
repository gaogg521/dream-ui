//! Mode-C request flow: `POST /v1/search`.
//!
//! Like [`crate::metered::service`], the core function takes `&AppState` and
//! knows nothing about HTTP, so the quota arithmetic can be tested directly.

use std::net::IpAddr;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use super::store;
use super::{SearchHit, UpstreamFailure, DEFAULT_RESULTS, MAX_RESULTS, MIN_QUERY_CHARS};
use crate::error::AppError;
use crate::service::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchRequest {
    /// This device, as dream-ui derives it. Only ever used as a quota bucket.
    pub install_id: String,
    pub query: String,
    pub count: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct QuotaView {
    pub used_today: i64,
    pub daily_limit: i64,
    pub remaining: i64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SearchResponse {
    /// Which upstream actually ran the search. Sent so the client can name it
    /// to the user instead of guessing, and so a future second provider does
    /// not need a client release.
    pub provider: &'static str,
    pub results: Vec<SearchHit>,
    pub quota: QuotaView,
}

/// Today in UTC, as the `search_usage.day` key.
///
/// UTC rather than any local zone: the broker has no idea where a device is,
/// and a per-request timezone would let a caller reset its own allowance by
/// claiming a new one.
fn today() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// This UTC month, as the `search_provider_usage.month` key. Vendor allowances
/// reset monthly, so this is the bucket the cap is measured against.
fn this_month() -> String {
    Utc::now().format("%Y-%m").to_string()
}

pub async fn run_search(
    state: &AppState,
    ip: IpAddr,
    request: &SearchRequest,
) -> Result<SearchResponse, AppError> {
    let providers = &state.search.providers;
    if providers.is_empty() {
        return Err(AppError::SearchUnavailable);
    }
    let limits = &state.search.limits;

    let install_id = request.install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    let query = request.query.trim();
    // Measured against the live API: Tavily answers 400 "Min query length is 2
    // characters" to a one-character query. Catching it here costs the caller
    // a clear 400 instead of a round trip, a reserved slot and a refund that
    // all end in an opaque `upstream_error`.
    if query.chars().count() < MIN_QUERY_CHARS {
        return Err(AppError::BadRequest(format!(
            "query must be at least {MIN_QUERY_CHARS} characters"
        )));
    }

    let count = request
        .count
        .unwrap_or(DEFAULT_RESULTS)
        .clamp(1, MAX_RESULTS);

    if !state.search.rate_limiter.check(ip) {
        return Err(AppError::RateLimited);
    }

    let day = today();
    prune_stale_days(state, &day).await;

    // The spend cap comes first: once the day is spent, a device that has not
    // touched its own allowance still must not be able to add to the bill.
    let global_used = store::used_today_global(&state.pool, &day)
        .await
        .map_err(db_error("search global usage"))?;
    if global_used >= limits.global_daily_limit {
        tracing::warn!(
            global_used,
            cap = limits.global_daily_limit,
            "hosted search daily cap reached"
        );
        return Err(AppError::SearchBudgetExhausted);
    }

    // Reserve before calling out, so two requests arriving together cannot
    // both read the same pre-limit count and both be let through.
    let used = store::reserve(&state.pool, install_id, &day)
        .await
        .map_err(db_error("search reserve"))?;
    if used > limits.daily_limit_per_install {
        refund(&state.pool, install_id, &day).await;
        return Err(AppError::SearchQuotaExhausted);
    }

    let quota = QuotaView {
        used_today: used,
        daily_limit: limits.daily_limit_per_install,
        remaining: (limits.daily_limit_per_install - used).max(0),
    };

    /*
     * Try each provider in turn; the first one that answers wins.
     *
     * "Answers" deliberately means a non-empty result, not merely a 200. The
     * providers have different coverage — a Chinese-language query can come
     * back empty from one and well-populated from the other — and an empty
     * answer is no more useful to the caller than an error. Falling through on
     * empty is what makes the second provider worth its extra call.
     *
     * The quota still counts ONE search: the slot is per user-visible search,
     * not per upstream call, so a fallback costs us an extra vendor call and
     * costs the user nothing.
     */
    let mut empty_from: Option<&'static str> = None;
    let mut failures = 0usize;
    let month = this_month();

    for (index, provider) in providers.iter().enumerate() {
        let is_last = index + 1 == providers.len();

        // A provider on a free allowance steps aside once it is spent, so the
        // next one takes over instead of this one starting to cost money.
        if let Some(cap) = provider.monthly_cap() {
            let used = store::provider_used_this_month(&state.pool, provider.id(), &month)
                .await
                .map_err(db_error("provider monthly usage"))?;
            if used >= cap {
                tracing::info!(
                    provider = provider.id(),
                    used,
                    cap,
                    "monthly allowance spent; handing over to the next provider"
                );
                continue;
            }
        }

        match provider.search(query, count).await {
            Ok(results) if !results.is_empty() => {
                record_call(&state.pool, provider.id(), &month).await;
                tracing::info!(
                    provider = provider.id(),
                    hits = results.len(),
                    used,
                    attempt = index + 1,
                    "hosted search served"
                );
                return Ok(SearchResponse {
                    provider: provider.id(),
                    results,
                    quota,
                });
            }
            Ok(_) => {
                // An empty answer is still a call the vendor served and bills
                // for, so it counts against the allowance just the same.
                record_call(&state.pool, provider.id(), &month).await;
                // Remember it: if nothing later does better, "this provider
                // looked and found nothing" is a truthful answer, and a more
                // useful one than an error.
                empty_from.get_or_insert(provider.id());
                if !is_last {
                    tracing::info!(
                        provider = provider.id(),
                        "no results; falling through to the next provider"
                    );
                }
            }
            Err(failure) => {
                failures += 1;
                match &failure {
                    UpstreamFailure::Status { status, body } => {
                        tracing::error!(provider = provider.id(), status, body = %body, "hosted search upstream rejected the call");
                    }
                    other => {
                        tracing::error!(provider = provider.id(), error = %other, "hosted search upstream call failed")
                    }
                }
            }
        }
    }

    // Something searched and found nothing. That is a result, not a fault, so
    // the slot stays spent and the caller gets an honest empty list.
    if let Some(provider) = empty_from {
        tracing::info!(provider, used, "hosted search returned no results");
        return Ok(SearchResponse {
            provider,
            results: Vec::new(),
            quota,
        });
    }

    // Every provider failed. A search no vendor ran is not one the user spent:
    // without the refund an outage would quietly eat every device's allowance
    // and keep reading as "quota exhausted" long after it ended.
    refund(&state.pool, install_id, &day).await;
    tracing::error!(failures, "hosted search exhausted every provider");
    // Upstream bodies can name our own key state; they never reach the client,
    // only the logs.
    Err(AppError::UpstreamError("search upstream failed".into()))
}

/// Counts one call against a provider's monthly allowance.
///
/// Only after the vendor answered: a request that never reached them costs
/// nothing, and spending the allowance on it would hand over to the fallback
/// early. Best effort — losing a count must not fail a search that succeeded.
async fn record_call(pool: &SqlitePool, provider: &str, month: &str) {
    if let Err(error) = store::record_provider_call(pool, provider, month).await {
        tracing::error!(error = %error, provider, "failed to record a provider call");
    }
}

async fn refund(pool: &SqlitePool, install_id: &str, day: &str) {
    if let Err(error) = store::release(pool, install_id, day).await {
        // Losing a refund costs the user one search, so it must not fail the
        // request that is already on its way out.
        tracing::error!(error = %error, "failed to release a reserved search slot");
    }
}

/// Drops counters from previous days, at most once per process per day.
///
/// Nothing reads a past day, and one row per device per day grows without
/// bound otherwise. Best effort: a failed sweep is a disk-space concern, never
/// a reason to fail a search.
async fn prune_stale_days(state: &AppState, day: &str) {
    {
        let last = state
            .search
            .last_pruned_day
            .lock()
            .expect("prune mutex poisoned");
        if last.as_deref() == Some(day) {
            return;
        }
    }
    match store::prune_before(&state.pool, day).await {
        Ok(removed) => {
            if removed > 0 {
                tracing::info!(removed, "pruned stale search usage rows");
            }
            let mut last = state
                .search
                .last_pruned_day
                .lock()
                .expect("prune mutex poisoned");
            *last = Some(day.to_string());
        }
        Err(error) => tracing::error!(error = %error, "failed to prune search usage rows"),
    }
}

fn db_error(context: &'static str) -> impl Fn(sqlx::Error) -> AppError {
    move |error| {
        tracing::error!(error = %error, context, "database error");
        AppError::Internal("database error".into())
    }
}

// --- axum handler -------------------------------------------------------

pub async fn search_handler(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::Json(payload): axum::Json<SearchRequest>,
) -> Result<axum::Json<SearchResponse>, AppError> {
    let ip = crate::routes::extract_client_ip(&headers, addr);
    Ok(axum::Json(run_search(&state, ip, &payload).await?))
}
