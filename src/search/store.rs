//! Per-install and global daily search counters.
//!
//! Every function takes the UTC day as a string so the caller owns the clock —
//! the same shape the mode-B store uses for `now_ms`, and what makes the
//! quota tests able to jump days without waiting for one.

use sqlx::SqlitePool;

/// Records one search against `install_id` on `day` and returns the new count
/// for that day.
///
/// Reserve-then-call: the row is incremented *before* the upstream request, so
/// two calls arriving together cannot both read the same pre-limit count and
/// both be allowed. The refund path ([`release`]) puts it back when the search
/// never happened.
pub async fn reserve(pool: &SqlitePool, install_id: &str, day: &str) -> sqlx::Result<i64> {
    sqlx::query(
        "INSERT INTO search_usage (install_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT (install_id, day) DO UPDATE SET count = count + 1",
    )
    .bind(install_id)
    .bind(day)
    .execute(pool)
    .await?;

    used_today(pool, install_id, day).await
}

/// Gives a reserved slot back after an upstream failure.
///
/// A search the vendor never ran is not a search the user spent. Without this,
/// a broker-side outage would silently eat everybody's daily allowance and the
/// quota would read as exhausted long after the outage ended.
///
/// Floors at zero rather than trusting the count: a refund that arrives twice
/// (a retried settle, a restart mid-flight) must not mint free quota.
pub async fn release(pool: &SqlitePool, install_id: &str, day: &str) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE search_usage SET count = MAX(count - 1, 0)
         WHERE install_id = ? AND day = ?",
    )
    .bind(install_id)
    .bind(day)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn used_today(pool: &SqlitePool, install_id: &str, day: &str) -> sqlx::Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COALESCE(count, 0) FROM search_usage WHERE install_id = ? AND day = ?",
    )
    .bind(install_id)
    .bind(day)
    .fetch_optional(pool)
    .await?
    .unwrap_or((0,));
    Ok(count)
}

/// Every search run today, across all installs — the spend circuit breaker.
pub async fn used_today_global(pool: &SqlitePool, day: &str) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COALESCE(SUM(count), 0) FROM search_usage WHERE day = ?")
            .bind(day)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

/// Drops counters older than `day`. Nothing reads a past day, and one row per
/// device per day would otherwise grow without bound.
pub async fn prune_before(pool: &SqlitePool, day: &str) -> sqlx::Result<u64> {
    let result = sqlx::query("DELETE FROM search_usage WHERE day < ?")
        .bind(day)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
