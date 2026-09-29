//! Mode-D request flow: `POST /v1/stt`.
//!
//! Like [`crate::search::service`], the core function takes `&AppState` and
//! knows nothing about HTTP, so the quota arithmetic can be tested without a
//! live upstream (see `tests/stt.rs`).

use std::net::IpAddr;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::store;
use super::{UpstreamFailure, MAX_AUDIO_BYTES};
use crate::error::AppError;
use crate::service::AppState;

#[derive(Debug, Deserialize)]
pub struct SttRequest {
    /// This device, as dream-core derives it. Only ever used as a quota
    /// bucket — never trusted for anything else.
    pub install_id: String,
    /// The clip's raw bytes, base64-encoded.
    pub audio_base64: String,
    /// e.g. "audio/webm;codecs=opus" — codec parameters are stripped before
    /// this reaches the vendor.
    pub mime_type: String,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SttQuotaView {
    pub used_today: i64,
    pub daily_limit: i64,
    pub remaining: i64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct SttResponse {
    /// Which upstream actually transcribed the clip, so the client can name
    /// it rather than guess, and a future second vendor needs no client
    /// release.
    pub provider: &'static str,
    /// An empty string is a legitimate answer — the clip had no speech in it
    /// — not an error.
    pub text: String,
    pub quota: SttQuotaView,
}

fn today() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Rough decoded size from the base64 length, without actually decoding —
/// this only needs to reject an oversized payload before it is sent anywhere.
fn estimated_decoded_len(base64: &str) -> usize {
    base64.len() * 3 / 4
}

pub async fn run_stt_transcribe(
    state: &AppState,
    ip: IpAddr,
    request: &SttRequest,
) -> Result<SttResponse, AppError> {
    let install_id = request.install_id.trim();
    if install_id.is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    if request.audio_base64.trim().is_empty() {
        return Err(AppError::BadRequest(
            "audio_base64 must not be empty".into(),
        ));
    }
    if estimated_decoded_len(&request.audio_base64) > MAX_AUDIO_BYTES {
        return Err(AppError::BadRequest(format!(
            "audio exceeds the {MAX_AUDIO_BYTES}-byte limit"
        )));
    }

    let reservation = reserve_stt_slot(state, ip, install_id).await?;
    let providers = &state.stt.providers;
    let quota = reservation.quota.clone();

    // Codec parameters (";codecs=opus") ride in the client's mimeType for its
    // own MediaRecorder bookkeeping; the vendor's data: URI wants the bare
    // media type.
    let clean_mime = request
        .mime_type
        .split(';')
        .next()
        .unwrap_or(&request.mime_type)
        .trim();

    // A single vendor today; kept as a loop (mirroring mode C) so adding a
    // fallback vendor later is an env change, not a rewrite of this function.
    for provider in providers.iter() {
        match provider
            .transcribe(
                &request.audio_base64,
                clean_mime,
                request.language.as_deref(),
            )
            .await
        {
            Ok(text) => {
                tracing::info!(
                    provider = provider.id(),
                    used = reservation.used,
                    chars = text.chars().count(),
                    "hosted stt served"
                );
                return Ok(SttResponse {
                    provider: provider.id(),
                    text,
                    quota,
                });
            }
            Err(failure) => match &failure {
                UpstreamFailure::Status { status, body } => {
                    tracing::error!(provider = provider.id(), status, body = %body, "hosted stt upstream rejected the call");
                }
                other => {
                    tracing::error!(provider = provider.id(), error = %other, "hosted stt upstream call failed")
                }
            },
        }
    }

    // Every provider failed. A transcription no vendor ran is not one the
    // user spent: without the refund an outage would quietly eat every
    // device's allowance and keep reading as "quota exhausted" long after it
    // ended.
    refund(&state.pool, install_id, &reservation.day).await;
    tracing::error!("hosted stt exhausted every provider");
    Err(AppError::UpstreamError("stt upstream failed".into()))
}

/// A consumed request slot. Streaming takes the same quota path as an HTTP
/// clip so opening a long-lived WebSocket cannot bypass daily limits.
#[derive(Debug, Clone)]
pub(crate) struct SttReservation {
    pub(crate) day: String,
    pub(crate) used: i64,
    pub(crate) quota: SttQuotaView,
}

pub(crate) async fn reserve_stt_slot(
    state: &AppState,
    ip: IpAddr,
    install_id: &str,
) -> Result<SttReservation, AppError> {
    if state.stt.providers.is_empty() {
        return Err(AppError::SttUnavailable);
    }
    if install_id.trim().is_empty() {
        return Err(AppError::BadRequest("install_id must not be empty".into()));
    }
    if !state.stt.rate_limiter.check(ip) {
        return Err(AppError::RateLimited);
    }

    let limits = &state.stt.limits;
    let day = today();
    prune_stale_days(state, &day).await;
    let global_used = store::used_today_global(&state.pool, &day)
        .await
        .map_err(db_error("stt global usage"))?;
    if global_used >= limits.global_daily_limit {
        tracing::warn!(
            global_used,
            cap = limits.global_daily_limit,
            "hosted stt daily cap reached"
        );
        return Err(AppError::SttBudgetExhausted);
    }

    let used = store::reserve(&state.pool, install_id, &day)
        .await
        .map_err(db_error("stt reserve"))?;
    if used > limits.daily_limit_per_install {
        refund(&state.pool, install_id, &day).await;
        return Err(AppError::SttQuotaExhausted);
    }
    Ok(SttReservation {
        day,
        used,
        quota: SttQuotaView {
            used_today: used,
            daily_limit: limits.daily_limit_per_install,
            remaining: (limits.daily_limit_per_install - used).max(0),
        },
    })
}

pub(crate) async fn refund(pool: &sqlx::SqlitePool, install_id: &str, day: &str) {
    if let Err(error) = store::release(pool, install_id, day).await {
        tracing::error!(error = %error, "failed to release a reserved stt slot");
    }
}

/// Drops counters from previous days, at most once per process per day.
async fn prune_stale_days(state: &AppState, day: &str) {
    {
        let last = state
            .stt
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
                tracing::info!(removed, "pruned stale stt usage rows");
            }
            let mut last = state
                .stt
                .last_pruned_day
                .lock()
                .expect("prune mutex poisoned");
            *last = Some(day.to_string());
        }
        Err(error) => tracing::error!(error = %error, "failed to prune stt usage rows"),
    }
}

fn db_error(context: &'static str) -> impl Fn(sqlx::Error) -> AppError {
    move |error| {
        tracing::error!(error = %error, context, "database error");
        AppError::Internal("database error".into())
    }
}

// --- axum handler -------------------------------------------------------

pub async fn stt_handler(
    axum::extract::State(state): axum::extract::State<std::sync::Arc<AppState>>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    headers: axum::http::HeaderMap,
    axum::Json(payload): axum::Json<SttRequest>,
) -> Result<axum::Json<SttResponse>, AppError> {
    let ip = crate::routes::extract_client_ip(&headers, addr);
    Ok(axum::Json(run_stt_transcribe(&state, ip, &payload).await?))
}
