//! Background settling of async (image / video) call costs.
//!
//! The proxy cannot bill an async job inline — it is not priced until the task
//! reaches a terminal state, and blocking the caller's stream to wait would be
//! unacceptable. Those request ids land in `metered_pending_costs`; this loop
//! re-queries each on a backoff until the vendor returns a figure, then applies
//! it through the same idempotent `apply_consume` the inline path uses.

use std::sync::Arc;
use std::time::Duration;

use super::{now_ms, store, CostOutcome, ProxiedCall};
use crate::service::AppState;

const POLL_INTERVAL: Duration = Duration::from_secs(20);
const BATCH: i64 = 50;
/// After this many failed looks, the charge is written off and logged rather
/// than retried forever. A metered proxy accepts bounded unbilled leakage
/// (handoff doc §3.6).
const MAX_ATTEMPTS: i64 = 20;

pub async fn run(state: Arc<AppState>) {
    if state.metered.is_empty() {
        return;
    }
    let mut ticker = tokio::time::interval(POLL_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        if let Err(e) = poll_once(&state).await {
            tracing::error!(error = %e, "pending-cost poll failed");
        }
    }
}

/// One settlement sweep over every due row. The loop above calls this on a
/// tick; tests call it directly to settle without waiting on the interval.
pub async fn poll_once(state: &AppState) -> anyhow::Result<()> {
    let due = store::due_pending(&state.pool, now_ms(), BATCH).await?;
    for pending in due {
        let Some(resolver) = state.metered.resolver(&pending.vendor).cloned() else {
            // Vendor removed from config since the row was queued — nothing
            // left that could price it.
            store::delete_pending(&state.pool, &pending.request_id).await?;
            continue;
        };

        let call = ProxiedCall {
            request_id: pending.request_id.clone(),
            task_id: pending.task_id.clone(),
        };
        let give_up = pending.attempts + 1 >= MAX_ATTEMPTS;

        match resolver.resolve(&call).await {
            Ok(CostOutcome::Settled(cents)) => {
                store::apply_consume(
                    &state.pool,
                    &pending.vendor,
                    &pending.install_id,
                    &pending.request_id,
                    cents,
                    now_ms(),
                )
                .await?;
                store::delete_pending(&state.pool, &pending.request_id).await?;
            }
            Ok(CostOutcome::Pending) if give_up => {
                tracing::error!(
                    request_id = %pending.request_id,
                    attempts = pending.attempts,
                    "giving up on an unsettled cost; this call goes unbilled"
                );
                store::delete_pending(&state.pool, &pending.request_id).await?;
            }
            Ok(CostOutcome::Pending) => {
                store::bump_pending(
                    &state.pool,
                    &pending.request_id,
                    now_ms() + backoff_ms(pending.attempts),
                )
                .await?;
            }
            Err(e) if give_up => {
                tracing::error!(
                    error = %e,
                    request_id = %pending.request_id,
                    "giving up on a cost query that keeps failing; this call goes unbilled"
                );
                store::delete_pending(&state.pool, &pending.request_id).await?;
            }
            Err(e) => {
                tracing::warn!(error = %e, request_id = %pending.request_id, "pending-cost retry errored");
                store::bump_pending(
                    &state.pool,
                    &pending.request_id,
                    now_ms() + backoff_ms(pending.attempts),
                )
                .await?;
            }
        }
    }
    Ok(())
}

/// Exponential-ish backoff capped at 10 minutes: 30s, 60s, 120s, ... .
fn backoff_ms(attempts: i64) -> i64 {
    let step = attempts.clamp(0, 5);
    (30_000_i64 * (1 << step)).min(600_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_then_caps() {
        assert_eq!(backoff_ms(0), 30_000);
        assert_eq!(backoff_ms(1), 60_000);
        assert_eq!(backoff_ms(2), 120_000);
        assert_eq!(backoff_ms(50), 600_000);
    }
}
