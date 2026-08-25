use std::env;

/// Small, easy-to-edit curated list of default trial models handed back to
/// callers alongside the issued key. Keep this short: cheap, capable,
/// well-known OpenRouter model slugs.
pub const DEFAULT_TRIAL_MODELS: &[&str] = &[
    "deepseek/deepseek-chat",
    "qwen/qwen-2.5-72b-instruct",
    "google/gemini-2.0-flash-001",
];

pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";

#[derive(Clone, Debug)]
pub struct Config {
    /// Privileged OpenRouter "Management Key" used to mint trial keys.
    /// Never logged, never hardcoded.
    pub openrouter_management_key: String,
    pub database_url: String,
    pub daily_budget_usd_cap: f64,
    pub trial_key_limit_usd: f64,
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
        let trial_key_expires_days = parse_env_or("TRIAL_KEY_EXPIRES_DAYS", 90i64)?;
        let listen_addr =
            env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
        let per_ip_rate_limit_per_hour = parse_env_or("PER_IP_RATE_LIMIT_PER_HOUR", 5u32)?;

        Ok(Self {
            openrouter_management_key,
            database_url,
            daily_budget_usd_cap,
            trial_key_limit_usd,
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
