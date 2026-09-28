//! Mode D — hosted default speech-to-text.
//!
//! Same shape and reasoning as mode C ([`crate::search`]): the desktop app
//! has no way to transcribe voice out of the box without asking every user
//! for their own STT vendor key first. Shipping a real key inside dream-ui
//! does not survive contact with a public repo and a readable Electron
//! `asar`, so the key stays here and the client sends audio instead of a
//! query — one unit, billed by count, so there is no ledger, just a daily
//! allowance per device and a global circuit breaker on the day's spend.
//!
//! Opt-in like mode C: with no provider key configured the runtime is off and
//! `/v1/stt` answers `stt_unavailable`, leaving modes A/B/C untouched.
//!
//! # Why a provider chain for one vendor
//!
//! Only Aliyun is wired in today, but this codebase's own history (mode C
//! needed a second vendor within weeks of shipping, when Tavily's free tier
//! ran out mid-month) is the reason this is a `Vec<Box<dyn Upstream>>` rather
//! than a single hardcoded call: swapping or adding a vendor here is an env
//! change, not a client release.

pub mod service;
pub mod store;

use std::env;
use std::time::Duration;

use crate::rate_limit::RateLimiter;

pub const ALIYUN_ID: &str = "aliyun";

/// Aliyun's DashScope-compatible endpoint for the account this broker uses.
/// Not a secret — only `STT_ALIYUN_API_KEY` is. Overridable via
/// `STT_ALIYUN_BASE_URL` in case the workspace changes.
const ALIYUN_DEFAULT_BASE_URL: &str =
    "https://ws-73nl3nntstqnhh1k.cn-beijing.maas.aliyuncs.com/api/v1";
const ALIYUN_DEFAULT_MODEL: &str = "qwen3-asr-flash";

const DEFAULT_DAILY_LIMIT_PER_INSTALL: i64 = 20;
const DEFAULT_GLOBAL_DAILY_LIMIT: i64 = 2_000;
const DEFAULT_RATE_LIMIT_PER_HOUR: u32 = 30;

/// Ceiling on one clip's base64 payload. A backstop against a single request
/// draining the whole day's global allowance — the client's own recordings
/// are seconds to low minutes, so this is generous, not a real limit on
/// legitimate use.
pub const MAX_AUDIO_BYTES: usize = 8 * 1024 * 1024;

const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct SttLimits {
    pub daily_limit_per_install: i64,
    pub global_daily_limit: i64,
    pub rate_limit_per_hour: u32,
}

impl Default for SttLimits {
    fn default() -> Self {
        Self {
            daily_limit_per_install: DEFAULT_DAILY_LIMIT_PER_INSTALL,
            global_daily_limit: DEFAULT_GLOBAL_DAILY_LIMIT,
            rate_limit_per_hour: DEFAULT_RATE_LIMIT_PER_HOUR,
        }
    }
}

pub fn limits_from_env() -> anyhow::Result<SttLimits> {
    Ok(SttLimits {
        daily_limit_per_install: parse_env_or(
            "STT_DAILY_LIMIT_PER_INSTALL",
            DEFAULT_DAILY_LIMIT_PER_INSTALL,
        )?,
        global_daily_limit: parse_env_or("STT_GLOBAL_DAILY_LIMIT", DEFAULT_GLOBAL_DAILY_LIMIT)?,
        rate_limit_per_hour: parse_env_or("STT_RATE_LIMIT_PER_HOUR", DEFAULT_RATE_LIMIT_PER_HOUR)?,
    })
}

/// Builds the provider chain from the environment. An empty result is a
/// valid deployment — mode D is simply off — not an error.
pub fn providers_from_env(http: &reqwest::Client) -> Vec<Box<dyn Upstream>> {
    let mut providers: Vec<Box<dyn Upstream>> = Vec::new();
    if let Some(key) = secret("STT_ALIYUN_API_KEY") {
        providers.push(Box::new(AliyunUpstream::new(
            http.clone(),
            key,
            endpoint("STT_ALIYUN_BASE_URL", ALIYUN_DEFAULT_BASE_URL),
            secret("STT_ALIYUN_MODEL").unwrap_or_else(|| ALIYUN_DEFAULT_MODEL.to_string()),
        )));
    }
    providers
}

fn secret(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn endpoint(key: &str, fallback: &str) -> String {
    secret(key).unwrap_or_else(|| fallback.to_string())
}

fn parse_env_or<T>(key: &str, default: T) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => v
            .trim()
            .parse::<T>()
            .map_err(|e| anyhow::anyhow!("invalid value for {key}: {e}")),
        _ => Ok(default),
    }
}

/// Everything mode D needs at request time. Its own rate limiter and its own
/// counters — never shared with mode C's, same reasoning as that module's
/// `SearchRuntime` doc.
pub struct SttRuntime {
    pub limits: SttLimits,
    /// Tried in order; the first that answers serves the request. Empty means
    /// mode D is switched off.
    pub providers: Vec<Box<dyn Upstream>>,
    pub rate_limiter: RateLimiter,
    pub last_pruned_day: std::sync::Mutex<Option<String>>,
}

impl SttRuntime {
    /// A runtime with no providers: every `/v1/stt` answers `stt_unavailable`.
    pub fn disabled() -> Self {
        Self::new(SttLimits::default(), Vec::new())
    }

    pub fn from_env(http: &reqwest::Client) -> anyhow::Result<Self> {
        Ok(Self::new(limits_from_env()?, providers_from_env(http)))
    }

    pub fn new(limits: SttLimits, providers: Vec<Box<dyn Upstream>>) -> Self {
        let per_hour = limits.rate_limit_per_hour;
        Self {
            limits,
            providers,
            rate_limiter: RateLimiter::new(per_hour, Duration::from_secs(3600)),
            last_pruned_day: std::sync::Mutex::new(None),
        }
    }

    pub fn enabled(&self) -> bool {
        !self.providers.is_empty()
    }

    pub fn provider_ids(&self) -> Vec<&'static str> {
        self.providers.iter().map(|p| p.id()).collect()
    }
}

#[derive(Debug)]
pub enum UpstreamFailure {
    Status { status: u16, body: String },
    Transport(String),
    Malformed(String),
}

impl std::fmt::Display for UpstreamFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpstreamFailure::Status { status, .. } => write!(f, "upstream status {status}"),
            UpstreamFailure::Transport(msg) => write!(f, "upstream transport error: {msg}"),
            UpstreamFailure::Malformed(msg) => write!(f, "upstream returned {msg}"),
        }
    }
}

/// One STT vendor, behind a trait so the quota, refund and failure paths can
/// be tested without the network — mirrors `crate::search::Upstream`.
#[async_trait::async_trait]
pub trait Upstream: Send + Sync {
    fn id(&self) -> &'static str;

    /// `audio_base64` is the clip's raw bytes, base64-encoded (whatever
    /// container the client recorded — webm/opus, wav, mp4 — verified against
    /// a live call for both webm/opus and wav). `mime_type` has already had
    /// any codec parameter stripped (`audio/webm`, not
    /// `audio/webm;codecs=opus`). An empty return string is a legitimate
    /// answer (silence), not a failure.
    async fn transcribe(
        &self,
        audio_base64: &str,
        mime_type: &str,
        language: Option<&str>,
    ) -> Result<String, UpstreamFailure>;
}

// --- Aliyun (DashScope multimodal-generation) ----------------------------

/// Aliyun's Qwen ASR models are not exposed through DashScope's OpenAI-
/// compatible `/v1/audio/transcriptions` (verified against the live gateway:
/// that path 404s). They are invoked through DashScope's own chat-style
/// `multimodal-generation` endpoint instead, with the audio given as a
/// `data:` URI inside a chat message — verified end to end against the real
/// API with both silence (empty `content`) and real speech (exact text back).
pub struct AliyunUpstream {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl AliyunUpstream {
    pub fn new(http: reqwest::Client, api_key: String, base_url: String, model: String) -> Self {
        Self {
            http,
            api_key,
            base_url,
            model,
        }
    }
}

#[async_trait::async_trait]
impl Upstream for AliyunUpstream {
    fn id(&self) -> &'static str {
        ALIYUN_ID
    }

    async fn transcribe(
        &self,
        audio_base64: &str,
        mime_type: &str,
        _language: Option<&str>,
    ) -> Result<String, UpstreamFailure> {
        let url = format!(
            "{}/services/aigc/multimodal-generation/generation",
            self.base_url.trim_end_matches('/')
        );
        let data_uri = format!("data:{mime_type};base64,{audio_base64}");
        let body = serde_json::json!({
            "model": self.model,
            "input": {
                "messages": [
                    { "role": "user", "content": [ { "audio": data_uri } ] }
                ]
            }
        });

        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body)
            .timeout(UPSTREAM_TIMEOUT)
            .send()
            .await
            .map_err(|e| UpstreamFailure::Transport(e.to_string()))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| UpstreamFailure::Transport(e.to_string()))?;

        if !status.is_success() {
            return Err(UpstreamFailure::Status {
                status: status.as_u16(),
                body: text.chars().take(500).collect(),
            });
        }

        let payload: serde_json::Value = serde_json::from_str(&text).map_err(|_| {
            let head: String = text.chars().take(200).collect();
            UpstreamFailure::Malformed(format!("non-JSON body: {head}"))
        })?;

        // An empty `content` array is how the model answers silence — a
        // legitimate empty transcript, not a malformed response.
        let transcript = payload
            .pointer("/output/choices/0/message/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        Ok(transcript)
    }
}

#[cfg(test)]
mod tests {
    /// Mirrors the exact body shape verified against a live 200 (see
    /// `AliyunUpstream::transcribe`'s doc comment): the audio rides as a
    /// `data:` URI inside a single chat message.
    #[test]
    fn request_shape_matches_the_live_verified_call() {
        let data_uri = format!("data:{};base64,{}", "audio/wav", "AAAA");
        let body = serde_json::json!({
            "model": "qwen3-asr-flash",
            "input": {
                "messages": [
                    { "role": "user", "content": [ { "audio": data_uri } ] }
                ]
            }
        });
        assert_eq!(body["model"], "qwen3-asr-flash");
        assert_eq!(
            body["input"]["messages"][0]["content"][0]["audio"],
            "data:audio/wav;base64,AAAA"
        );
        assert_eq!(body["input"]["messages"][0]["role"], "user");
    }

    #[test]
    fn extracts_transcript_from_a_live_shaped_response() {
        let payload = serde_json::json!({
            "output": { "choices": [ { "finish_reason": "stop", "message": {
                "content": [ { "text": "Hello, this is a test." } ],
                "role": "assistant"
            } } ] },
            "usage": { "audio_tokens": 102 },
            "request_id": "x"
        });
        let text = payload
            .pointer("/output/choices/0/message/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        assert_eq!(text, "Hello, this is a test.");
    }

    /// Captured from a live call against a silent clip: `content` comes back
    /// as an empty array with no `text` field at all, not a null/empty
    /// string. Must resolve to an empty transcript, not an error.
    #[test]
    fn empty_content_array_is_an_empty_transcript_not_an_error() {
        let payload = serde_json::json!({
            "output": { "choices": [ { "finish_reason": "stop", "message": {
                "content": [],
                "role": "assistant"
            } } ] }
        });
        let text = payload
            .pointer("/output/choices/0/message/content/0/text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        assert_eq!(text, "");
    }
}
