use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::routes::build_router;
use dream_trial_broker::service::AppState;
use dream_trial_broker::vendor::openrouter::OpenRouterVendor;
use dream_trial_broker::vendor::TokenVendor;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Best-effort: pick up a local .env file for `cargo run` convenience.
    // Never required in production, where real env vars should be set.
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let listen_addr: SocketAddr = config.listen_addr.parse()?;

    let pool = db::init_pool(&config.database_url).await?;
    // One vendor for now. When there are several this becomes a lookup keyed
    // by config; the trait boundary is already where it needs to be.
    let vendor: Arc<dyn TokenVendor> = Arc::new(OpenRouterVendor::new(
        config.openrouter_management_key.clone(),
    ));
    let rate_limiter = Arc::new(RateLimiter::new(
        config.per_ip_rate_limit_per_hour,
        Duration::from_secs(3600),
    ));

    let state = Arc::new(AppState {
        pool,
        config: Arc::new(config),
        vendor,
        rate_limiter,
    });

    tracing::info!(%listen_addr, vendor = state.vendor.id(), "starting dream-trial-broker");

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(listen_addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
