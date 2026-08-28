use std::env;

/// Curated list of trial models handed back to callers alongside the issued
/// key. **Order is meaningful: the client selects the first entry as the
/// active model.**
///
/// Every slug here was verified against `GET /api/v1/models` — in particular
/// the leading `~` on the DeepSeek entry is part of the real slug, not URL
/// decoration (`deepseek/deepseek-v4-flash-latest` without it does not exist).
///
/// Free-first while the product is still in its promotion phase: a new user's
/// first impression costs them nothing and costs us nothing.
///
/// Know the trade-off this makes. `openrouter/free` is $0, so it spends none
/// of the key's allowance — a user who stays on the default will never reach
/// the cap and never see a top-up prompt. What actually constrains them is
/// OpenRouter's free-tier *request* quota, which is metered per account
/// **globally** and therefore shared across every trial user at once, not
/// per key. Reordering so a paid model leads is the one-line change that
/// turns the allowance back into the binding constraint.
pub const DEFAULT_TRIAL_MODELS: &[&str] = &[
    // Default. Free models only, $0, no allowance spent — see the note above
    // for what this costs us in conversion.
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
    // Cheapest per token of the paid options ($0.03/M in, $0.10/M out —
    // roughly 33M input tokens inside a $1 allowance) and the fastest measured
    // (~1s vs ~4-5s for the router). An alias that always points at the newest
    // V4 Flash build.
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
