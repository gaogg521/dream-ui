//! Mode C — hosted web search.
//!
//! The desktop app had no way to search the live web out of the box. The
//! obvious fix — ship a search key inside the app — does not survive contact
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
//! Opt-in like mode B: with no provider key configured the runtime is off and
//! `/v1/search` answers `search_unavailable`, leaving modes A and B untouched.
//!
//! # Why more than one provider
//!
//! Providers are tried in order and the first that answers wins. That is not
//! redundancy for its own sake: Tavily and Zhipu have genuinely different
//! coverage, and a Chinese-language query that returns nothing from one
//! routinely returns good results from the other. A fallback also means one
//! vendor's outage, expiry or exhausted quota degrades the feature instead of
//! ending it.

pub mod service;
pub mod store;

use std::env;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::rate_limit::RateLimiter;

pub const TAVILY_ID: &str = "tavily";
pub const ZHIPU_ID: &str = "zhipu";

const TAVILY_DEFAULT_URL: &str = "https://api.tavily.com/search";
const ZHIPU_DEFAULT_URL: &str = "https://open.bigmodel.cn/api/paas/v4/web_search";

/// Zhipu's cheapest tier, and the only one this service sends.
///
/// Pinned rather than configurable on purpose: the account owner picked the
/// basic tier deliberately, and an env var here would let a future edit
/// silently start billing the `search_pro*` tiers on someone else's account.
const ZHIPU_ENGINE: &str = "search_std";

/// Order providers are tried in when nothing says otherwise.
const DEFAULT_PROVIDER_ORDER: &str = "tavily,zhipu";

const DEFAULT_DAILY_LIMIT_PER_INSTALL: i64 = 50;
const DEFAULT_GLOBAL_DAILY_LIMIT: i64 = 5_000;
const DEFAULT_RATE_LIMIT_PER_HOUR: u32 = 60;

/// Ceiling on `count`, whatever the caller asks for. Vendors bill per search
/// rather than per result, but a caller asking for a hundred still costs
/// latency here and tokens downstream.
pub const MAX_RESULTS: i64 = 20;
/// Shortest query worth sending. The upstream rejects anything shorter, so
/// this is a real limit rather than a taste judgement.
pub const MIN_QUERY_CHARS: usize = 2;
pub const DEFAULT_RESULTS: i64 = 8;

const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(20);

/// The quota rules, which are about the service rather than any one vendor.
#[derive(Clone, Debug)]
pub struct SearchLimits {
    /// Searches one install may run per UTC day.
    pub daily_limit_per_install: i64,
    /// Searches every install together may run per UTC day — the spend cap.
    pub global_daily_limit: i64,
    pub rate_limit_per_hour: u32,
}

impl Default for SearchLimits {
    fn default() -> Self {
        Self {
            daily_limit_per_install: DEFAULT_DAILY_LIMIT_PER_INSTALL,
            global_daily_limit: DEFAULT_GLOBAL_DAILY_LIMIT,
            rate_limit_per_hour: DEFAULT_RATE_LIMIT_PER_HOUR,
        }
    }
}

pub fn limits_from_env() -> anyhow::Result<SearchLimits> {
    Ok(SearchLimits {
        daily_limit_per_install: parse_env_or(
            "SEARCH_DAILY_LIMIT_PER_INSTALL",
            DEFAULT_DAILY_LIMIT_PER_INSTALL,
        )?,
        global_daily_limit: parse_env_or("SEARCH_GLOBAL_DAILY_LIMIT", DEFAULT_GLOBAL_DAILY_LIMIT)?,
        rate_limit_per_hour: parse_env_or(
            "SEARCH_RATE_LIMIT_PER_HOUR",
            DEFAULT_RATE_LIMIT_PER_HOUR,
        )?,
    })
}

/// Builds the provider chain from the environment, in the order given by
/// `SEARCH_PROVIDER_ORDER`. An empty result is a valid deployment — mode C is
/// simply off — not an error.
pub fn providers_from_env(http: &reqwest::Client) -> Vec<Box<dyn Upstream>> {
    let order = env::var("SEARCH_PROVIDER_ORDER")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_PROVIDER_ORDER.to_string());

    let mut providers: Vec<Box<dyn Upstream>> = Vec::new();
    for name in order.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        match name {
            TAVILY_ID => {
                if let Some(key) = secret("SEARCH_TAVILY_API_KEY") {
                    providers.push(Box::new(TavilyUpstream::new(
                        http.clone(),
                        key,
                        endpoint("SEARCH_TAVILY_BASE_URL", TAVILY_DEFAULT_URL),
                    )));
                }
            }
            ZHIPU_ID => {
                if let Some(key) = secret("SEARCH_ZHIPU_API_KEY") {
                    providers.push(Box::new(ZhipuUpstream::new(
                        http.clone(),
                        key,
                        endpoint("SEARCH_ZHIPU_BASE_URL", ZHIPU_DEFAULT_URL),
                    )));
                }
            }
            other => tracing::warn!(
                provider = other,
                "SEARCH_PROVIDER_ORDER names a provider this build does not implement; ignored"
            ),
        }
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

/// Everything mode C needs at request time.
///
/// Its own rate limiter, not mode A's: five requests an hour is right for
/// minting a trial key and absurd for search, where one conversation can
/// reasonably run several queries in a minute.
pub struct SearchRuntime {
    pub limits: SearchLimits,
    /// Tried in order; the first that answers serves the request. Empty means
    /// mode C is switched off.
    pub providers: Vec<Box<dyn Upstream>>,
    pub rate_limiter: RateLimiter,
    /// The UTC day whose stale-row sweep has already run in this process, so
    /// the `DELETE` happens once a day rather than once a request.
    pub last_pruned_day: Mutex<Option<String>>,
}

impl SearchRuntime {
    /// A runtime with no providers: every `/v1/search` answers
    /// `search_unavailable`.
    pub fn disabled() -> Self {
        Self::new(SearchLimits::default(), Vec::new())
    }

    pub fn from_env(http: &reqwest::Client) -> anyhow::Result<Self> {
        Ok(Self::new(limits_from_env()?, providers_from_env(http)))
    }

    pub fn new(limits: SearchLimits, providers: Vec<Box<dyn Upstream>>) -> Self {
        let per_hour = limits.rate_limit_per_hour;
        Self {
            limits,
            providers,
            rate_limiter: RateLimiter::new(per_hour, Duration::from_secs(3600)),
            last_pruned_day: Mutex::new(None),
        }
    }

    pub fn enabled(&self) -> bool {
        !self.providers.is_empty()
    }

    /// Provider ids in the order they will be tried — for the startup log.
    pub fn provider_ids(&self) -> Vec<&'static str> {
        self.providers.iter().map(|p| p.id()).collect()
    }
}

/// One normalised result. The client renders these verbatim, so the shape
/// matches what its own vendor adapters produce — swapping a user key for the
/// hosted path must not change what the model sees, and neither must a
/// fallback from one provider to another.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub title: String,
    /// Absent when the vendor supplied no link.
    ///
    /// Not hypothetical, and not an error: Zhipu's `search_std` returns whole
    /// dated summaries with `link: ""` for a large share of Chinese news
    /// results — measured at 0 of 4 for one query, 3 of 4 for another, 8 of 8
    /// for an English one. Dropping those emptied the Chinese provider exactly
    /// where it was added to help, so the chain fell through to the vendor with
    /// the worse Chinese coverage every time. A dated summary from a named
    /// source is worth having; what it must not do is invite an invented
    /// citation, which is why it is `None` rather than an empty string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
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

/// One search vendor, behind a trait so the chain, quota, refund and failure
/// paths can all be tested without the network.
///
/// Each implementation owns its own credential and endpoint: the two vendors
/// agree on nothing — not the auth style, not the request body, not even the
/// name of the field holding the result URL — so a shared config struct would
/// only have been a union of unrelated fields.
#[async_trait::async_trait]
pub trait Upstream: Send + Sync {
    fn id(&self) -> &'static str;

    /// Whether this vendor indexes the Chinese web well enough to be asked
    /// first for a Chinese-language query.
    ///
    /// Measured, not assumed. Asked for the 2026 figures on Chinese EV
    /// exports, Tavily returned three results — a university course page among
    /// them — and reported perfect success; Zhipu returned the industry
    /// association numbers from the week before. Without this the chain would
    /// have stopped at Tavily every time, because "non-empty" is not the same
    /// as "answered", and the fallback would have been dead code for exactly
    /// the queries it was added for.
    fn prefers_chinese_queries(&self) -> bool {
        false
    }

    async fn search(&self, query: &str, count: i64) -> Result<Vec<SearchHit>, UpstreamFailure>;
}

/// Whether a query is written in Chinese.
///
/// One Han character is enough: a mixed query like `Rust 1.90 发布说明` comes
/// from someone who wants Chinese-language sources, and the Chinese engines
/// handle the Latin half of it perfectly well. The reverse is not true.
pub fn is_chinese_query(query: &str) -> bool {
    query.chars().any(|c| {
        matches!(c,
            '\u{4E00}'..='\u{9FFF}'      // CJK Unified Ideographs
            | '\u{3400}'..='\u{4DBF}'    // Extension A
            | '\u{F900}'..='\u{FAFF}'    // Compatibility Ideographs
        )
    })
}

/// Sends the request and hands back the parsed body, or the reason it could
/// not. Shared because the failure taxonomy is the same for every vendor even
/// though the request shape is not.
async fn post_json(
    http: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, UpstreamFailure> {
    let response = http
        .post(url)
        .bearer_auth(api_key)
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

    serde_json::from_str(&text).map_err(|_| {
        let head: String = text.chars().take(200).collect();
        UpstreamFailure::Malformed(format!("non-JSON body: {head}"))
    })
}

// --- Tavily -------------------------------------------------------------

pub struct TavilyUpstream {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl TavilyUpstream {
    pub fn new(http: reqwest::Client, api_key: String, base_url: String) -> Self {
        Self {
            http,
            api_key,
            base_url,
        }
    }
}

#[async_trait::async_trait]
impl Upstream for TavilyUpstream {
    fn id(&self) -> &'static str {
        TAVILY_ID
    }

    async fn search(&self, query: &str, count: i64) -> Result<Vec<SearchHit>, UpstreamFailure> {
        // Bearer, not an `api_key` body field: measured against the live API,
        // which answers 401 to the older documented body form.
        let payload = post_json(
            &self.http,
            &self.base_url,
            &self.api_key,
            serde_json::json!({ "query": query, "max_results": count }),
        )
        .await?;
        Ok(map_results(payload.get("results"), &TAVILY_FIELDS, count))
    }
}

// --- Zhipu --------------------------------------------------------------

pub struct ZhipuUpstream {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl ZhipuUpstream {
    pub fn new(http: reqwest::Client, api_key: String, base_url: String) -> Self {
        Self {
            http,
            api_key,
            base_url,
        }
    }
}

#[async_trait::async_trait]
impl Upstream for ZhipuUpstream {
    fn id(&self) -> &'static str {
        ZHIPU_ID
    }

    fn prefers_chinese_queries(&self) -> bool {
        true
    }

    async fn search(&self, query: &str, count: i64) -> Result<Vec<SearchHit>, UpstreamFailure> {
        let payload = post_json(
            &self.http,
            &self.base_url,
            &self.api_key,
            serde_json::json!({
                "search_engine": ZHIPU_ENGINE,
                "search_query": query,
                "count": count,
                // Required by the vendor schema, and the value matters: with
                // intent detection on, a query it reads as conversational
                // comes back `SEARCH_NONE` and no search is run at all. This
                // tool is only ever called when a search is already wanted.
                "search_intent": false,
            }),
        )
        .await?;
        Ok(map_results(
            payload.get("search_result"),
            &ZHIPU_FIELDS,
            count,
        ))
    }
}

// --- normalisation ------------------------------------------------------

/// Which keys carry which value in one vendor's result object.
pub struct ResultFields {
    pub url: &'static str,
    pub title: &'static str,
    pub snippet: &'static str,
    pub published: &'static str,
}

/// Captured from a live 200, not read off the docs.
pub const TAVILY_FIELDS: ResultFields = ResultFields {
    url: "url",
    title: "title",
    snippet: "content",
    published: "published_date",
};

/// Also captured from a live 200 — and it is why a shared mapping would have
/// been wrong: Zhipu puts the link in `link`, not `url`, so reusing Tavily's
/// field names here would have dropped every single result while reporting a
/// perfectly healthy 200.
pub const ZHIPU_FIELDS: ResultFields = ResultFields {
    url: "link",
    title: "title",
    snippet: "content",
    published: "publish_date",
};

/// Maps one vendor's result array onto [`SearchHit`].
///
/// A result is kept when it has something to say — a title or a snippet. The
/// url is optional (see [`SearchHit::url`]); an item with neither text nor
/// link is dropped, because there is nothing left of it.
pub fn map_results(
    results: Option<&serde_json::Value>,
    fields: &ResultFields,
    limit: i64,
) -> Vec<SearchHit> {
    let Some(items) = results.and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let url = string_at(item, fields.url);
            let title = string_at(item, fields.title);
            let snippet = string_at(item, fields.snippet).unwrap_or_default();
            // Something a reader could act on: a headline, a summary, or at
            // minimum a link to follow.
            if title.is_none() && snippet.is_empty() && url.is_none() {
                return None;
            }
            Some(SearchHit {
                title: title.or_else(|| url.clone()).unwrap_or_default(),
                url,
                snippet,
                published_at: string_at(item, fields.published),
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
    fn spots_a_chinese_query_including_a_mixed_one() {
        assert!(is_chinese_query("中国新能源汽车出口"));
        // Mixed is still a Chinese query: the person wants Chinese sources.
        assert!(is_chinese_query("Rust 1.90 发布说明"));
        assert!(!is_chinese_query("Rust 1.90 release notes"));
        assert!(!is_chinese_query(""));
        // Punctuation and digits alone are not a language signal.
        assert!(!is_chinese_query("GPT-5 2026?!"));
    }

    #[test]
    fn maps_a_live_shaped_tavily_payload() {
        let payload = serde_json::json!({
            "query": "x",
            "results": [
                { "url": "https://a.test/1", "title": "A", "content": "body a" },
                { "url": "https://b.test/2", "title": "B", "content": "body b", "published_date": "2026-01-02" }
            ]
        });
        let hits = map_results(payload.get("results"), &TAVILY_FIELDS, 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].snippet, "body a");
        assert_eq!(hits[1].published_at.as_deref(), Some("2026-01-02"));
        assert!(hits[0].published_at.is_none());
    }

    /// The difference that would otherwise be invisible: a healthy 200 with
    /// every result silently dropped, because Zhipu calls the link `link`.
    #[test]
    fn maps_a_live_shaped_zhipu_payload() {
        let payload = serde_json::json!({
            "search_result": [
                { "link": "https://a.test/1", "title": "A", "content": "body a", "publish_date": "2026-09-11" }
            ]
        });
        let hits = map_results(payload.get("search_result"), &ZHIPU_FIELDS, 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url.as_deref(), Some("https://a.test/1"));
        assert_eq!(hits[0].published_at.as_deref(), Some("2026-09-11"));

        // And the proof that the two mappings are not interchangeable: read
        // with Tavily's field names, the link is simply lost.
        let wrong = map_results(payload.get("search_result"), &TAVILY_FIELDS, 10);
        assert!(wrong[0].url.is_none());
    }

    /// Zhipu returns dated summaries with an empty `link` for much of the
    /// Chinese news it indexes. Those are kept — with no url rather than an
    /// empty one, so nothing downstream can render a broken citation — because
    /// dropping them emptied the provider exactly where it was meant to help.
    #[test]
    fn keeps_a_result_that_has_text_but_no_link() {
        let payload = serde_json::json!({
            "search_result": [
                { "link": "", "title": "中国汽车出口连续3个月破百万辆", "content": "中汽协数据显示…", "publish_date": "2026-09-10" }
            ]
        });
        let hits = map_results(payload.get("search_result"), &ZHIPU_FIELDS, 10);
        assert_eq!(hits.len(), 1);
        assert!(
            hits[0].url.is_none(),
            "an empty link must not become an empty url"
        );
        assert_eq!(hits[0].published_at.as_deref(), Some("2026-09-10"));
    }

    /// Nothing to show and nowhere to go: there is no result left to pass on.
    #[test]
    fn drops_a_result_with_neither_text_nor_link() {
        let payload =
            serde_json::json!({ "results": [{ "url": "  ", "title": " ", "content": "" }] });
        assert!(map_results(payload.get("results"), &TAVILY_FIELDS, 10).is_empty());
    }

    #[test]
    fn falls_back_to_the_url_when_a_title_is_missing() {
        let payload = serde_json::json!({ "results": [{ "url": "https://a.test/1" }] });
        let hits = map_results(payload.get("results"), &TAVILY_FIELDS, 10);
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
        assert_eq!(
            map_results(payload.get("results"), &TAVILY_FIELDS, 2).len(),
            2
        );
        assert!(map_results(None, &TAVILY_FIELDS, 5).is_empty());
        let no_key = serde_json::json!({ "answer": "no results key" });
        assert!(map_results(no_key.get("results"), &TAVILY_FIELDS, 5).is_empty());
    }
}
