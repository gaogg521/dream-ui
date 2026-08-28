use std::env;

/// Curated list of trial models handed back to callers alongside the issued
/// key. Order is meaningful: the client selects the first entry as the
/// active model, so this runs cheapest-first and ends on a paid fallback.
///
/// Every slug here was verified against `GET /api/v1/models` — in particular
/// the leading `~` on the DeepSeek entry is part of the real slug, not URL
/// decoration (`deepseek/deepseek-v4-flash-latest` without it does not exist).
///
/// Cost note: `openrouter/free` spends none of the key's daily USD cap, but
/// OpenRouter meters free-tier *requests* per account, globally — so that
/// ceiling is shared across every trial user, not per key. The routers and
/// the paid fallback below are what the per-key $1/day cap actually governs.
pub const DEFAULT_TRIAL_MODELS: &[&str] = &[
    // Free models only — costs nothing, draws on the account-wide free quota.
    "openrouter/free",
    // Task-aware router: classifies each request, then picks the most popular
    // model for that task, billed at the routed model's rate.
    //
    // Deliberately NOT paired with the older `openrouter/auto`. Measured over
    // three prompts, `auto` cost 5-8x more for the same work: it injects ~85
    // extra input tokens of routing preamble into every request (billed input
    // was 97/103/100 tokens for 12/18/15-token prompts, while `auto-beta`
    // billed exactly the prompt length) and routes to a pricier variant. Two
    // entries both reading "Auto Router" would also just confuse a first-time
    // user picking a model.
    "openrouter/auto-beta",
    // Paid fallback that is always available when the routers or the free
    // pool are not ($0.03/M in, $0.10/M out — ~33M input tokens inside the
    // $1/day cap).
    "~deepseek/deepseek-v4-flash-latest",
];

pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";

#[derive(Clone, Debug)]
pub struct Config {
    /// Privileged OpenRouter "Management Key" used to mint trial keys.
    /// Never logged, never hardcoded.
    pub openrouter_management_key: String,
    pub database_url: String,
    /// Ceiling on how much *new* spend liability may be handed out in a single
    /// day. One issuance adds `trial_key_limit_usd` of liability per
    /// `trial_key_limit_reset` period, so at the defaults this is "at most 50
    /// new trial users per day".
    pub daily_budget_usd_cap: f64,
    /// Hard spend cap OpenRouter enforces on each issued key, per
    /// `trial_key_limit_reset` period.
    pub trial_key_limit_usd: f64,
    /// How often OpenRouter resets each key's spend counter: `monthly` (the
    /// default) or `daily`. This is the difference between a trial user
    /// costing at most $1/month and at most $1/day — i.e. up to ~$30/month —
    /// so it is deliberately explicit rather than left to a library default.
    pub trial_key_limit_reset: String,
    pub trial_key_expires_days: i64,
    pub listen_addr: String,
    pub per_ip_rate_limit_per_hour: u32,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let openrouter_management_key = env::var("OPENROUTER_MANAGEMENT_KEY")
            .map_err(|_| anyhow::anyhow!("OPENROUTER_MANAGEMENT_KEY is required"))?;

        if openrouter_management_key.trim().is_empty() {
            anyhow::bail!("OPENROUTER_MANAGEMENT_KEY must not be empty");
        }

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://trial-broker.db".to_string());

        let daily_budget_usd_cap = parse_env_or("DAILY_BUDGET_USD_CAP", 50.0)?;
        let trial_key_limit_usd = parse_env_or("TRIAL_KEY_LIMIT_USD", 1.0)?;
        let trial_key_limit_reset =
            env::var("TRIAL_KEY_LIMIT_RESET").unwrap_or_else(|_| "monthly".to_string());
        // Reject anything else up front: an unknown value would be sent to
        // OpenRouter verbatim, and a key it refuses to cap is a key with no
        // spend ceiling at all.
        if !matches!(trial_key_limit_reset.as_str(), "monthly" | "daily") {
            anyhow::bail!(
                "TRIAL_KEY_LIMIT_RESET must be `monthly` or `daily`, got `{trial_key_limit_reset}`"
            );
        }
        let trial_key_expires_days = parse_env_or("TRIAL_KEY_EXPIRES_DAYS", 90i64)?;
        let listen_addr =
            env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
        let per_ip_rate_limit_per_hour = parse_env_or("PER_IP_RATE_LIMIT_PER_HOUR", 5u32)?;

        Ok(Self {
            openrouter_management_key,
            database_url,
            daily_budget_usd_cap,
            trial_key_limit_usd,
            trial_key_limit_reset,
            trial_key_expires_days,
            listen_addr,
            per_ip_rate_limit_per_hour,
        })
    }
}

fn parse_env_or<T>(key: &str, default: T) -> anyhow::Result<T>
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    match env::var(key) {
        Ok(v) => v
            .parse::<T>()
            .map_err(|e| anyhow::anyhow!("invalid value for {key}: {e}")),
        Err(_) => Ok(default),
    }
}
