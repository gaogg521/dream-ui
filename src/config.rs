use std::env;

use crate::vendor::ResetPeriod;

/// Baoyun-specific mode A settings. `Option`-wrapped on [`Config`]: absent
/// `BAOYUN_ACCESS_TOKEN` means the vendor is not enabled, mirroring how mode
/// B's Baoyun config is opt-in (`crate::metered::baoyun::config_from_env`).
#[derive(Clone, Debug)]
pub struct BaoyunAccountConfig {
    /// System access token from Baoyun's console (a different credential
    /// from any `sk-` key — see `crate::vendor::baoyun`). Never logged.
    pub access_token: String,
    /// Logical issuer label recorded on new Baoyun issuance rows.  The
    /// public API continues to call the vendor `baoyun`; this distinguishes
    /// the reseller member that owns a key from the historical parent
    /// account that may still own older keys.
    pub issuer_account: String,
    /// Parent-account token used only for historical rows whose
    /// `baoyun_account` is NULL.  It must be supplied during the one-time
    /// switch to `onework` while any such rows remain active.
    pub legacy_access_token: Option<String>,
    /// Free trial grant, in CNY. Baoyun's `remain` never renews on its own,
    /// so this is a one-time balance, not a monthly allowance.
    pub trial_key_limit_cny: f64,
    /// Same role as `daily_budget_usd_cap` but scoped to Baoyun's own
    /// currency — see `count_active_issued_since`'s per-vendor scoping.
    pub daily_budget_cny_cap: f64,
}

#[derive(Clone, Debug)]
pub struct Config {
    /// Privileged OpenRouter "Management Key" used to mint trial keys.
    /// Never logged, never hardcoded.
    pub openrouter_management_key: String,
    pub baoyun: Option<BaoyunAccountConfig>,
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
    /// Legacy resale markup.  New `onework` keys use the default 1.0: Baoyun
    /// reseller pricing is the only customer price.  The setting remains for
    /// historical parent-account issuances so their already-purchased credit
    /// can still be reconciled faithfully.
    pub topup_price_markup: f64,
    /// Kill switch for real-money top-ups, independent of any vendor's own
    /// support for the operation — `.env` edit + restart, no rebuild. Checked
    /// once, at the top of `crate::topup::create_topup_order` (the only path
    /// that starts a real payment); does not affect `apply_top_up` (ops-only,
    /// not a user payment) or reading existing balance. Defaults to `true`.
    pub topup_enabled: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let openrouter_management_key = env::var("OPENROUTER_MANAGEMENT_KEY")
            .map_err(|_| anyhow::anyhow!("OPENROUTER_MANAGEMENT_KEY is required"))?;

        if openrouter_management_key.trim().is_empty() {
            anyhow::bail!("OPENROUTER_MANAGEMENT_KEY must not be empty");
        }

        let baoyun = match env::var("BAOYUN_ACCESS_TOKEN") {
            Ok(access_token) if !access_token.trim().is_empty() => Some(BaoyunAccountConfig {
                access_token,
                issuer_account: env::var("BAOYUN_ISSUER_ACCOUNT")
                    .unwrap_or_else(|_| "legacy".to_string()),
                legacy_access_token: match env::var("BAOYUN_LEGACY_ACCESS_TOKEN") {
                    Ok(token) if !token.trim().is_empty() => Some(token),
                    Ok(_) => anyhow::bail!("BAOYUN_LEGACY_ACCESS_TOKEN is set but empty"),
                    Err(_) => None,
                },
                trial_key_limit_cny: parse_env_or("BAOYUN_TRIAL_KEY_LIMIT_CNY", 5.0)?,
                // Kept at 50 new trial users/day (matches the OpenRouter cap's
                // stated policy) — halved alongside the ¥10 -> ¥5 grant so the
                // per-day user count this implies doesn't silently double.
                daily_budget_cny_cap: parse_env_or("BAOYUN_DAILY_BUDGET_CNY_CAP", 250.0)?,
            }),
            Ok(_) => anyhow::bail!("BAOYUN_ACCESS_TOKEN is set but empty"),
            Err(_) => None,
        };

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

        // 1:1 is now the production default: the Baoyun reseller member's
        // configured price is the only end-user discount/markup layer.
        let topup_price_markup = parse_env_or("TOPUP_PRICE_MARKUP", 1.0f64)?;
        // `<=` alone would let NaN through (every comparison against NaN is
        // false), so it needs its own check — same guard as topup amounts.
        if topup_price_markup.is_nan() || topup_price_markup <= 0.0 {
            anyhow::bail!("TOPUP_PRICE_MARKUP must be a positive number, got {topup_price_markup}");
        }
        let topup_enabled = parse_env_or("TOPUP_ENABLED", true)?;

        Ok(Self {
            openrouter_management_key,
            baoyun,
            database_url,
            daily_budget_usd_cap,
            trial_key_limit_usd,
            trial_key_limit_reset,
            trial_key_expires_days,
            listen_addr,
            per_ip_rate_limit_per_hour,
            public_base_url,
            topup_price_markup,
            topup_enabled,
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
