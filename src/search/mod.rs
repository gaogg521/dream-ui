//! Mode C — hosted web search.
//!
//! The desktop app had no way to search the live web out of the box. The
//! obvious fix — ship a Tavily key inside the app — does not survive contact
//! with reality: dream-ui is a public repository and an Electron `asar` is a
//! readable archive, so a bundled key is a published key. It gets scanned,
//! revoked, and search then breaks for every user at once, with no way to
//! rotate short of a release.
//!
//! So the key stays here and the client sends a query instead. That is the
//! same move mode B makes for inference, minus the money: a search is one
//! unit, billed by count, so there is no ledger and no top-up — just a daily
//! allowance per device and a global circuit breaker on the day's spend.
//!
//! Opt-in like mode B: with no `SEARCH_TAVILY_API_KEY` the runtime is off and
//! `/v1/search` answers `search_unavailable`, leaving modes A and B untouched.

pub mod service;
pub mod store;

use std::env;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::rate_limit::RateLimiter;

/// The upstream this mode calls. One provider, deliberately: the client
/// already supports nine vendors when the *user* supplies the key, and the
/// point of the hosted path is a working default, not a second vendor matrix.
pub const PROVIDER_ID: &str = "tavily";

const DEFAULT_BASE_URL: &str = "https://api.tavily.com/search";
const DEFAULT_DAILY_LIMIT_PER_INSTALL: i64 = 50;
const DEFAULT_GLOBAL_DAILY_LIMIT: i64 = 5_000;
const DEFAULT_RATE_LIMIT_PER_HOUR: u32 = 60;

/// Ceiling on `count`, whatever the caller asks for. Tavily bills per search
/// rather than per result, but a caller asking for a hundred still costs
/// latency here and tokens downstream.
pub const MAX_RESULTS: i64 = 20;
/// Shortest query worth sending. The upstream rejects anything shorter, so
/// this is a real limit rather than a taste judgement.
pub const MIN_QUERY_CHARS: usize = 2;
pub const DEFAULT_RESULTS: i64 = 8;

const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Debug)]
pub struct SearchConfig {
    /// Secret. Never logged, never returned to a client.
    pub api_key: String,
    pub base_url: String,
    /// Searches one install may run per UTC day.
    pub daily_limit_per_install: i64,
    /// Searches every install together may run per UTC day — the spend cap.
    pub global_daily_limit: i64,
    pub rate_limit_per_hour: u32,
}

/// Reads mode C from the environment. `Ok(None)` means "not configured",
/// which is a valid deployment rather than an error.
pub fn config_from_env() -> anyhow::Result<Option<SearchConfig>> {
    let api_key = match env::var("SEARCH_TAVILY_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value.trim().to_string(),
        _ => return Ok(None),
    };

    let base_url = env::var("SEARCH_TAVILY_BASE_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());

    Ok(Some(SearchConfig {
        api_key,
        base_url,
        daily_limit_per_install: parse_env_or(
            "SEARCH_DAILY_LIMIT_PER_INSTALL",
            DEFAULT_DAILY_LIMIT_PER_INSTALL,
        )?,
        global_daily_limit: parse_env_or("SEARCH_GLOBAL_DAILY_LIMIT", DEFAULT_GLOBAL_DAILY_LIMIT)?,
        rate_limit_per_hour: parse_env_or(
            "SEARCH_RATE_LIMIT_PER_HOUR",
            DEFAULT_RATE_LIMIT_PER_HOUR,
        )?,
    }))
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

/// Everything mode C needs at request time.
///
/// Its own rate limiter, not mode A's: five requests an hour is right for
/// minting a trial key and absurd for search, where one conversation can
/// reasonably run several queries in a minute.
pub struct SearchRuntime {
    pub config: Option<SearchConfig>,
    pub rate_limiter: RateLimiter,
    /// The upstream call. Production holds a [`TavilyUpstream`]; tests swap in
    /// a stand-in so the quota, refund and failure paths can be exercised
    /// without reaching the real API.
    pub upstream: Box<dyn Upstream>,
    /// The UTC day whose stale-row sweep has already run in this process, so
    /// the `DELETE` happens once a day rather than once a request.
    pub last_pruned_day: Mutex<Option<String>>,
}

impl SearchRuntime {
    /// A runtime with no key: every `/v1/search` answers `search_unavailable`.
    pub fn disabled() -> Self {
        Self::with_upstream(None, Box::new(TavilyUpstream::new(reqwest::Client::new())))
    }

    pub fn new(config: Option<SearchConfig>, http: reqwest::Client) -> Self {
        Self::with_upstream(config, Box::new(TavilyUpstream::new(http)))
    }

    pub fn with_upstream(config: Option<SearchConfig>, upstream: Box<dyn Upstream>) -> Self {
        let per_hour = config
            .as_ref()
            .map(|c| c.rate_limit_per_hour)
            .unwrap_or(DEFAULT_RATE_LIMIT_PER_HOUR);
        Self {
            config,
            rate_limiter: RateLimiter::new(per_hour, Duration::from_secs(3600)),
            upstream,
            last_pruned_day: Mutex::new(None),
        }
    }

    pub fn enabled(&self) -> bool {
        self.config.is_some()
    }
}

/// One normalised result. The client renders these verbatim, so the shape
/// matches what its own vendor adapters produce — swapping a user key for the
/// hosted path must not change what the model sees.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
}

#[derive(Debug)]
pub enum UpstreamFailure {
    /// Upstream answered, but not with success. Carries status and body so an
    /// auth failure can be told from a rate limit in the logs.
    Status { status: u16, body: String },
    /// No answer at all: connection refused, DNS, timeout.
    Transport(String),
    /// A 2xx carrying something that is not the JSON we expect.
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

/// The upstream search call, behind a trait so every path around it can be
/// tested without the network.
#[async_trait::async_trait]
pub trait Upstream: Send + Sync {
    async fn search(
        &self,
        config: &SearchConfig,
        query: &str,
        count: i64,
    ) -> Result<Vec<SearchHit>, UpstreamFailure>;
}

pub struct TavilyUpstream {
    http: reqwest::Client,
}

impl TavilyUpstream {
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }
}

#[async_trait::async_trait]
impl Upstream for TavilyUpstream {
    async fn search(
        &self,
        config: &SearchConfig,
        query: &str,
        count: i64,
    ) -> Result<Vec<SearchHit>, UpstreamFailure> {
        let response = self
            .http
            .post(&config.base_url)
            // Bearer, not an `api_key` body field: measured against the live
            // API, which answers 401 to the older documented body form.
            .bearer_auth(&config.api_key)
            .json(&serde_json::json!({ "query": query, "max_results": count }))
            .timeout(UPSTREAM_TIMEOUT)
            .send()
            .await
            .map_err(|e| UpstreamFailure::Transport(e.to_string()))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| UpstreamFailure::Transport(e.to_string()))?;

        if !status.is_success() {
            return Err(UpstreamFailure::Status {
                status: status.as_u16(),
                body: body.chars().take(500).collect(),
            });
        }

        let payload: serde_json::Value = serde_json::from_str(&body).map_err(|_| {
            let head: String = body.chars().take(200).collect();
            UpstreamFailure::Malformed(format!("non-JSON body: {head}"))
        })?;

        Ok(normalise(&payload, count))
    }
}

/// Maps the Tavily payload onto [`SearchHit`].
///
/// `content` is the snippet field — verified against a live 200 response, not
/// read off the docs. A result with no url is dropped rather than shipped with
/// an empty one: the point of a hit is something the model can cite.
pub fn normalise(payload: &serde_json::Value, limit: i64) -> Vec<SearchHit> {
    let Some(results) = payload.get("results").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    results
        .iter()
        .filter_map(|item| {
            let url = string_at(item, "url")?;
            Some(SearchHit {
                title: string_at(item, "title").unwrap_or_else(|| url.clone()),
                url,
                snippet: string_at(item, "content").unwrap_or_default(),
                published_at: string_at(item, "published_date"),
            })
        })
        .take(limit.max(0) as usize)
        .collect()
}

fn string_at(item: &serde_json::Value, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_a_live_shaped_payload() {
        let payload = serde_json::json!({
            "query": "x",
            "results": [
                { "url": "https://a.test/1", "title": "A", "content": "body a" },
                { "url": "https://b.test/2", "title": "B", "content": "body b", "published_date": "2026-01-02" }
            ]
        });
        let hits = normalise(&payload, 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].snippet, "body a");
        assert_eq!(hits[1].published_at.as_deref(), Some("2026-01-02"));
        assert!(hits[0].published_at.is_none());
    }

    /// A hit with no url is not a citation, and passing it on would put an
    /// empty link in front of the model.
    #[test]
    fn drops_results_without_a_url() {
        let payload = serde_json::json!({
            "results": [{ "title": "no link", "content": "x" }, { "url": "  ", "title": "blank" }]
        });
        assert!(normalise(&payload, 10).is_empty());
    }

    #[test]
    fn falls_back_to_the_url_when_a_title_is_missing() {
        let payload = serde_json::json!({ "results": [{ "url": "https://a.test/1" }] });
        let hits = normalise(&payload, 10);
        assert_eq!(hits[0].title, "https://a.test/1");
        assert_eq!(hits[0].snippet, "");
    }

    #[test]
    fn honours_the_limit_and_an_absent_results_array() {
        let payload = serde_json::json!({
            "results": [
                { "url": "https://a.test/1" }, { "url": "https://b.test/2" }, { "url": "https://c.test/3" }
            ]
        });
        assert_eq!(normalise(&payload, 2).len(), 2);
        assert!(normalise(&serde_json::json!({ "answer": "no results key" }), 5).is_empty());
    }
}
