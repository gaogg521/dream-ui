use std::env;

use crate::vendor::ResetPeriod;

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
    /// How often the vendor resets each key's spend counter. Defaults to
    /// monthly.
    ///
    /// This is the difference between a trial user costing at most $1/month
    /// and at most $1/day — i.e. up to ~$30/month — so it is deliberately
    /// explicit rather than left to a default anywhere further down.
    pub trial_key_limit_reset: ResetPeriod,
    pub trial_key_expires_days: i64,
    pub listen_addr: String,
    pub per_ip_rate_limit_per_hour: u32,
    /// The broker's own externally-reachable base URL (scheme + host + any
    /// reverse-proxy path prefix, no trailing slash). Mode B's claim response
    /// builds the client's proxy `base_url` from it. Defaults to
    /// `http://<listen_addr>`, which is only right for local dev.
    pub public_base_url: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let openrouter_management_key = env::var("OPENROUTER_MANAGEMENT_KEY")
            .map_err(|_| anyhow::anyhow!("OPENROUTER_MANAGEMENT_KEY is required"))?;

        if openrouter_management_key.trim().is_empty() {
            anyhow::bail!("OPENROUTER_MANAGEMENT_KEY must not be empty");
        }

        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://trial-broker.db".to_string());

        let daily_budget_usd_cap = parse_env_or("DAILY_BUDGET_USD_CAP", 50.0)?;
        let trial_key_limit_usd = parse_env_or("TRIAL_KEY_LIMIT_USD", 1.0)?;
        let raw_reset = env::var("TRIAL_KEY_LIMIT_RESET").unwrap_or_else(|_| "monthly".to_string());
        // Reject anything else up front. An unrecognised value must never
        // reach a vendor verbatim: a cap it refuses to parse is a key with no
        // spend ceiling at all.
        let trial_key_limit_reset = ResetPeriod::parse(&raw_reset).ok_or_else(|| {
            anyhow::anyhow!("TRIAL_KEY_LIMIT_RESET must be `monthly`, `daily` or `cumulative`, got `{raw_reset}`")
        })?;
        let trial_key_expires_days = parse_env_or("TRIAL_KEY_EXPIRES_DAYS", 90i64)?;
        let listen_addr = env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
        let per_ip_rate_limit_per_hour = parse_env_or("PER_IP_RATE_LIMIT_PER_HOUR", 5u32)?;
        let public_base_url = env::var("PUBLIC_BASE_URL")
            .unwrap_or_else(|_| format!("http://{listen_addr}"))
            .trim_end_matches('/')
            .to_string();

        Ok(Self {
            openrouter_management_key,
            database_url,
            daily_budget_usd_cap,
            trial_key_limit_usd,
            trial_key_limit_reset,
            trial_key_expires_days,
            listen_addr,
            per_ip_rate_limit_per_hour,
            public_base_url,
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
