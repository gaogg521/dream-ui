//! Filling in `issuances.key_hash` for keys issued before migration 0008.
//!
//! The "paste your key, see your usage" query (`crate::topup::usage_by_key`)
//! finds a key by the hash recorded when it was minted. Keys issued before
//! that column existed have `key_hash = NULL`, so they match nothing — and
//! since a trial key is long-lived (90 days, renewed only by recovery), that
//! is not a handful of stale rows that drain away on their own: it is every
//! user who claimed before the feature shipped, permanently unable to use
//! it. The first real report was exactly that — a key sitting in the app's
//! own provider row, rejected by the page as "no active key matches".
//!
//! This broker never stores plaintext, so the hash cannot be recovered from
//! its own data. It can be recovered from the vendor: Baoyun re-reveals a
//! live key's plaintext on demand (`TokenVendor::reveal_key`, verified in
//! docs §11.12). So on startup, for every vendor that supports revealing,
//! each `NULL` row is revealed once, hashed, and written back. Vendors
//! without `reveal_key` (OpenRouter) are skipped whole — nothing to do, and
//! nothing that needs them, since only Baoyun answers usage queries.
//!
//! Runs detached from startup: a slow or rate-limited vendor must never keep
//! the service from listening.

use std::sync::Arc;
use std::time::Duration;

use crate::db;
use crate::service::{hash_key, AppState};
use crate::vendor::VendorError;

/// Baoyun rate-limits repeated reveals ("短时间内重复请求会触发限流"), and
/// this is housekeeping with nobody waiting on it, so it goes deliberately
/// slowly.
const DELAY_BETWEEN_REVEALS: Duration = Duration::from_secs(2);

pub async fn run(state: Arc<AppState>) {
    for (vendor_id, vendor) in state.vendors.iter() {
        let rows = match db::list_active_without_key_hash(&state.pool, vendor_id).await {
            Ok(rows) => rows,
            Err(e) => {
                tracing::error!(error = %e, vendor = *vendor_id, "key-hash backfill: db read failed");
                continue;
            }
        };
        if rows.is_empty() {
            continue;
        }

        tracing::info!(
            vendor = *vendor_id,
            pending = rows.len(),
            "key-hash backfill: starting"
        );

        let mut filled = 0usize;
        for row in rows {
            match vendor.reveal_key(&row.vendor_key_handle).await {
                Ok(secret) => {
                    if let Err(e) = db::set_key_hash(&state.pool, &row.id, &hash_key(&secret)).await
                    {
                        tracing::error!(error = %e, vendor = *vendor_id, "key-hash backfill: db write failed");
                    } else {
                        filled += 1;
                    }
                }
                // A vendor with no reveal support has nothing to backfill —
                // stop rather than walk the rest of its rows one timeout at
                // a time.
                Err(VendorError::Unsupported { .. }) => {
                    tracing::debug!(
                        vendor = *vendor_id,
                        "key-hash backfill: vendor cannot reveal keys, skipping"
                    );
                    break;
                }
                Err(e) => {
                    // One dead or rate-limited key must not abort the rest;
                    // whatever is left is retried on the next restart.
                    tracing::warn!(
                        error = %e,
                        vendor = *vendor_id,
                        handle = %row.vendor_key_handle,
                        "key-hash backfill: reveal failed, leaving it for next startup"
                    );
                }
            }
            tokio::time::sleep(DELAY_BETWEEN_REVEALS).await;
        }

        tracing::info!(vendor = *vendor_id, filled, "key-hash backfill: done");
    }
}
