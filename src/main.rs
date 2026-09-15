use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use dream_trial_broker::config::Config;
use dream_trial_broker::db;
use dream_trial_broker::metered::gateway::MockGateway;
use dream_trial_broker::metered::{baoyun, poller, CostResolver, MeteredRuntime, PaymentGateway};
use dream_trial_broker::rate_limit::RateLimiter;
use dream_trial_broker::routes::build_router;
use dream_trial_broker::search;
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

    let metered = Arc::new(build_metered_runtime()?);

    // Mode C. Opt-in the same way mode B is: no key, no hosted search.
    let search_config = search::config_from_env()?;
    if search_config.is_some() {
        tracing::info!(provider = search::PROVIDER_ID, "hosted search enabled");
    }
    let search = Arc::new(search::SearchRuntime::new(
        search_config,
        reqwest::Client::new(),
    ));

    let state = Arc::new(AppState {
        pool,
        config: Arc::new(config),
        vendor,
        rate_limiter,
        metered,
        search,
    });

    tracing::info!(
        %listen_addr,
        vendor = state.vendor.id(),
        metered_vendors = state.metered.configs.len(),
        hosted_search = state.search.enabled(),
        "starting dream-trial-broker"
    );

    // Settles async (image / video) call costs that could not be billed inline.
    tokio::spawn(poller::run(Arc::clone(&state)));

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(listen_addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}

/// Assembles mode B from the environment. A metered vendor is opt-in: with no
/// `BAOYUN_MASTER_API_KEY` the runtime has no vendors and every
/// `/v1/metered/*` route 404s, leaving mode A untouched.
fn build_metered_runtime() -> anyhow::Result<MeteredRuntime> {
    let http = reqwest::Client::new();
    let mut configs = HashMap::new();
    let mut resolvers: HashMap<&'static str, Arc<dyn CostResolver>> = HashMap::new();

    if let Some(config) = baoyun::config_from_env()? {
        let resolver = Arc::new(baoyun::RemoteCostResolver::new(http.clone(), &config));
        resolvers.insert(baoyun::ID, resolver as Arc<dyn CostResolver>);
        configs.insert(baoyun::ID, config);
        tracing::info!("metered vendor enabled: baoyun");
    }

    let gateway: Arc<dyn PaymentGateway> = Arc::new(MockGateway::from_env());
    if !configs.is_empty() {
        tracing::warn!(
            gateway = gateway.id(),
            "metered proxy is using the {} payment gateway — no real money moves",
            gateway.id()
        );
    }

    Ok(MeteredRuntime {
        configs,
        resolvers,
        gateway,
        http,
    })
}
