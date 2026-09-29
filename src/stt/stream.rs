//! Realtime hosted STT bridge.
//!
//! Dream Core connects here with raw PCM16 frames. This broker is the trust
//! boundary: it validates and charges the install, then speaks DashScope's
//! vendor WebSocket protocol with the API key that never reaches a client.

use std::net::SocketAddr;

use axum::extract::{
    ws::{Message as ClientMessage, WebSocket, WebSocketUpgrade},
    ConnectInfo, State,
};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, http::HeaderValue, Message as UpstreamMessage,
};

use super::service::{refund, reserve_stt_slot};
use super::{secret, ALIYUN_DEFAULT_BASE_URL, ALIYUN_STREAMING_MODEL, MAX_AUDIO_BYTES};
use crate::error::AppError;
use crate::service::AppState;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum StartFrame {
    Start {
        install_id: String,
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
        #[serde(default)]
        #[serde(rename = "languageHint")]
        language_hint: Option<String>,
    },
}

fn frame(kind: &str, extra: serde_json::Value) -> ClientMessage {
    let mut value = serde_json::json!({ "type": kind });
    if let (Some(dst), Some(src)) = (value.as_object_mut(), extra.as_object()) {
        dst.extend(src.clone());
    }
    ClientMessage::Text(value.to_string())
}

async fn send_error(socket: &mut WebSocket, code: &str, msg: &str) {
    let _ = socket
        .send(frame(
            "error",
            serde_json::json!({ "code": code, "msg": msg }),
        ))
        .await;
}

/// Public WebSocket endpoint. It deliberately accepts no DashScope credential:
/// the caller only proves a broker install id, exactly like `/v1/stt`.
pub async fn stt_stream_handler(
    State(state): State<std::sync::Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let ip = crate::routes::extract_client_ip(&headers, addr);
    ws.on_upgrade(move |socket| stream_socket(socket, state, ip))
}

async fn stream_socket(
    mut client: WebSocket,
    state: std::sync::Arc<AppState>,
    ip: std::net::IpAddr,
) {
    let Some(Ok(ClientMessage::Text(raw))) = client.recv().await else {
        return;
    };
    let StartFrame::Start {
        install_id,
        sample_rate,
        language_hint,
    } = match serde_json::from_str(&raw) {
        Ok(frame) => frame,
        Err(_) => {
            send_error(
                &mut client,
                "STT_STREAM_PROTOCOL",
                "expected a valid start frame",
            )
            .await;
            return;
        }
    };
    if !(8_000..=48_000).contains(&sample_rate) {
        send_error(
            &mut client,
            "STT_STREAM_PROTOCOL",
            "sample rate must be between 8000 and 48000 Hz",
        )
        .await;
        return;
    }
    let install_id = install_id.trim().to_owned();
    let reservation = match reserve_stt_slot(&state, ip, &install_id).await {
        Ok(value) => value,
        Err(error) => {
            send_app_error(&mut client, error).await;
            return;
        }
    };

    let Some(api_key) = secret("STT_ALIYUN_API_KEY") else {
        refund(&state.pool, &install_id, &reservation.day).await;
        send_error(
            &mut client,
            "STT_UNAVAILABLE",
            "hosted speech-to-text is unavailable",
        )
        .await;
        return;
    };
    let base_url =
        secret("STT_ALIYUN_BASE_URL").unwrap_or_else(|| ALIYUN_DEFAULT_BASE_URL.to_owned());
    let url = match streaming_url(&base_url) {
        Ok(url) => url,
        Err(message) => {
            refund(&state.pool, &install_id, &reservation.day).await;
            send_error(&mut client, "STT_REQUEST_FAILED", &message).await;
            return;
        }
    };
    let mut request = match url.clone().into_client_request() {
        Ok(request) => request,
        Err(error) => {
            refund(&state.pool, &install_id, &reservation.day).await;
            send_error(
                &mut client,
                "STT_REQUEST_FAILED",
                &format!("invalid upstream URL: {error}"),
            )
            .await;
            return;
        }
    };
    let auth = match HeaderValue::from_str(&format!("Bearer {api_key}")) {
        Ok(value) => value,
        Err(_) => {
            refund(&state.pool, &install_id, &reservation.day).await;
            send_error(
                &mut client,
                "STT_REQUEST_FAILED",
                "invalid upstream authorization",
            )
            .await;
            return;
        }
    };
    request.headers_mut().insert("Authorization", auth);
    let (mut upstream, _) = match tokio_tungstenite::connect_async(request).await {
        Ok(value) => value,
        Err(error) => {
            refund(&state.pool, &install_id, &reservation.day).await;
            send_error(
                &mut client,
                "STT_REQUEST_FAILED",
                &format!("upstream connection failed: {error}"),
            )
            .await;
            return;
        }
    };
    let task_id = uuid::Uuid::new_v4().simple().to_string();
    let mut parameters = serde_json::json!({ "format": "pcm", "sample_rate": sample_rate });
    if let Some(language) = language_hint
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        parameters["language_hints"] = serde_json::json!([language]);
    }
    let start = serde_json::json!({
        "header": { "action": "run-task", "task_id": task_id, "streaming": "duplex" },
        "payload": { "task_group": "audio", "task": "asr", "function": "recognition", "model": ALIYUN_STREAMING_MODEL, "parameters": parameters, "input": {} }
    });
    if upstream
        .send(UpstreamMessage::Text(start.to_string()))
        .await
        .is_err()
    {
        refund(&state.pool, &install_id, &reservation.day).await;
        send_error(
            &mut client,
            "STT_REQUEST_FAILED",
            "could not start upstream recognition",
        )
        .await;
        return;
    }

    let mut started = false;
    let mut stopping = false;
    let mut bytes_received = 0usize;
    loop {
        tokio::select! {
            client_message = client.recv(), if !stopping => match client_message {
                Some(Ok(ClientMessage::Binary(bytes))) => {
                    bytes_received = bytes_received.saturating_add(bytes.len());
                    if bytes_received > MAX_AUDIO_BYTES {
                        send_error(&mut client, "STT_FILE_TOO_LARGE", "streamed audio exceeds the size limit").await;
                        return;
                    }
                    if let Err(error) = upstream.send(UpstreamMessage::Binary(bytes)).await {
                        send_error(&mut client, "STT_REQUEST_FAILED", &format!("upstream audio send failed: {error}")).await;
                        return;
                    }
                }
                Some(Ok(ClientMessage::Text(text))) if text.contains("\"type\":\"stop\"") => {
                    let finish = serde_json::json!({ "header": { "action": "finish-task", "task_id": task_id, "streaming": "duplex" }, "payload": { "input": {} } });
                    if let Err(error) = upstream.send(UpstreamMessage::Text(finish.to_string())).await {
                        send_error(&mut client, "STT_REQUEST_FAILED", &format!("upstream finish failed: {error}")).await;
                        return;
                    }
                    stopping = true;
                }
                Some(Ok(ClientMessage::Close(_))) | None | Some(Err(_)) => return,
                _ => { send_error(&mut client, "STT_STREAM_PROTOCOL", "unexpected client frame").await; return; }
            },
            upstream_message = upstream.next() => match upstream_message {
                Some(Ok(UpstreamMessage::Text(text))) => match handle_upstream_text(&text) {
                    UpstreamEvent::Started => { started = true; if client.send(frame("ready", serde_json::json!({}))).await.is_err() { return; } }
                    UpstreamEvent::Partial(text) => { if client.send(frame("partial", serde_json::json!({"text": text}))).await.is_err() { return; } }
                    UpstreamEvent::Final(text) => { if client.send(frame("final", serde_json::json!({"text": text}))).await.is_err() { return; } }
                    UpstreamEvent::Finished => { let _ = client.send(frame("done", serde_json::json!({}))).await; return; }
                    UpstreamEvent::Failed(message) => { send_error(&mut client, "STT_REQUEST_FAILED", &message).await; return; }
                    UpstreamEvent::Ignore => {}
                },
                Some(Ok(UpstreamMessage::Close(_))) | None => {
                    if !started { refund(&state.pool, &install_id, &reservation.day).await; }
                    send_error(&mut client, "STT_REQUEST_FAILED", "upstream closed unexpectedly").await; return;
                }
                Some(Err(error)) => { if !started { refund(&state.pool, &install_id, &reservation.day).await; } send_error(&mut client, "STT_REQUEST_FAILED", &format!("upstream error: {error}")).await; return; }
                _ => {}
            }
        }
    }
}

async fn send_app_error(socket: &mut WebSocket, error: AppError) {
    let (code, message) = match error {
        AppError::SttUnavailable => (
            "STT_UNAVAILABLE",
            "hosted speech-to-text is unavailable".to_owned(),
        ),
        AppError::SttQuotaExhausted => (
            "STT_QUOTA_EXHAUSTED",
            "daily speech quota exhausted".to_owned(),
        ),
        AppError::SttBudgetExhausted => (
            "STT_BUDGET_EXHAUSTED",
            "daily hosted speech budget exhausted".to_owned(),
        ),
        AppError::RateLimited => ("STT_RATE_LIMITED", "too many speech requests".to_owned()),
        other => ("STT_REQUEST_FAILED", other.to_string()),
    };
    send_error(socket, code, &message).await;
}

fn streaming_url(base_url: &str) -> Result<String, String> {
    let base = base_url.trim_end_matches('/').trim_end_matches("/api/v1");
    let ws = base
        .strip_prefix("https://")
        .map(|rest| format!("wss://{rest}"))
        .or_else(|| {
            base.strip_prefix("http://")
                .map(|rest| format!("ws://{rest}"))
        })
        .ok_or_else(|| "base URL must use http or https".to_owned())?;
    Ok(format!("{ws}/api-ws/v1/inference"))
}

enum UpstreamEvent {
    Started,
    Partial(String),
    Final(String),
    Finished,
    Failed(String),
    Ignore,
}

fn handle_upstream_text(text: &str) -> UpstreamEvent {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return UpstreamEvent::Ignore;
    };
    match value
        .pointer("/header/event")
        .and_then(serde_json::Value::as_str)
    {
        Some("task-started") => UpstreamEvent::Started,
        Some("task-finished") => UpstreamEvent::Finished,
        Some("task-failed") => UpstreamEvent::Failed(
            value
                .pointer("/header/error_message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("upstream task failed")
                .to_owned(),
        ),
        Some("result-generated") => {
            let sentence = value.pointer("/payload/output/sentence");
            let text = sentence
                .and_then(|sentence| sentence.get("text"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            if text.is_empty() {
                return UpstreamEvent::Ignore;
            }
            if sentence
                .and_then(|sentence| sentence.get("sentence_end"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                UpstreamEvent::Final(text)
            } else {
                UpstreamEvent::Partial(text)
            }
        }
        _ => UpstreamEvent::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn converts_http_api_base_to_dashscope_streaming_url() {
        assert_eq!(
            streaming_url("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1").unwrap(),
            "wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"
        );
    }
    #[test]
    fn maps_dashscope_result_lifecycle() {
        assert!(matches!(
            handle_upstream_text(r#"{"header":{"event":"task-started"}}"#),
            UpstreamEvent::Started
        ));
        assert!(
            matches!(handle_upstream_text(r#"{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"hello","sentence_end":false}}}}"#), UpstreamEvent::Partial(text) if text == "hello")
        );
        assert!(
            matches!(handle_upstream_text(r#"{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"hello","sentence_end":true}}}}"#), UpstreamEvent::Final(text) if text == "hello")
        );
    }
}
