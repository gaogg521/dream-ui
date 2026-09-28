//! Per-install and global daily hosted-STT counters.
//!
//! Identical shape to `crate::search::store` — see that module for the
//! reserve-then-call rationale. Kept as its own copy rather than shared code
//! because that is the established convention for these independent modes
//! (own key, own table, own limiter; see `AppState` field docs).

use sqlx::SqlitePool;

/// Records one transcription against `install_id` on `day` and returns the
/// new count for that day.
pub async fn reserve(pool: &SqlitePool, install_id: &str, day: &str) -> sqlx::Result<i64> {
    sqlx::query(
        "INSERT INTO stt_usage (install_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT (install_id, day) DO UPDATE SET count = count + 1",
    )
    .bind(install_id)
    .bind(day)
    .execute(pool)
    .await?;

    used_today(pool, install_id, day).await
}

/// Gives a reserved slot back after an upstream failure — a transcription the
/// vendor never ran is not one the user spent.
pub async fn release(pool: &SqlitePool, install_id: &str, day: &str) -> sqlx::Result<()> {
    sqlx::query("UPDATE stt_usage SET count = MAX(count - 1, 0) WHERE install_id = ? AND day = ?")
        .bind(install_id)
        .bind(day)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn used_today(pool: &SqlitePool, install_id: &str, day: &str) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COALESCE(count, 0) FROM stt_usage WHERE install_id = ? AND day = ?")
            .bind(install_id)
            .bind(day)
            .fetch_optional(pool)
            .await?
            .unwrap_or((0,));
    Ok(count)
}

/// Every transcription run today, across all installs — the spend circuit
/// breaker.
pub async fn used_today_global(pool: &SqlitePool, day: &str) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as("SELECT COALESCE(SUM(count), 0) FROM stt_usage WHERE day = ?")
            .bind(day)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

/// Drops counters older than `day`.
pub async fn prune_before(pool: &SqlitePool, day: &str) -> sqlx::Result<u64> {
    let result = sqlx::query("DELETE FROM stt_usage WHERE day < ?")
        .bind(day)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_pool;

    async fn memory_pool() -> SqlitePool {
        init_pool("sqlite::memory:").await.unwrap()
    }

    #[tokio::test]
    async fn reserve_increments_and_reads_back() {
        let pool = memory_pool().await;
        assert_eq!(reserve(&pool, "install-1", "2026-01-01").await.unwrap(), 1);
        assert_eq!(reserve(&pool, "install-1", "2026-01-01").await.unwrap(), 2);
        assert_eq!(
            used_today(&pool, "install-1", "2026-01-01").await.unwrap(),
            2
        );
    }

    #[tokio::test]
    async fn release_floors_at_zero() {
        let pool = memory_pool().await;
        release(&pool, "install-1", "2026-01-01").await.unwrap();
        release(&pool, "install-1", "2026-01-01").await.unwrap();
        assert_eq!(
            used_today(&pool, "install-1", "2026-01-01").await.unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn used_today_global_sums_every_install() {
        let pool = memory_pool().await;
        reserve(&pool, "install-1", "2026-01-01").await.unwrap();
        reserve(&pool, "install-2", "2026-01-01").await.unwrap();
        reserve(&pool, "install-2", "2026-01-01").await.unwrap();
        assert_eq!(used_today_global(&pool, "2026-01-01").await.unwrap(), 3);
    }

    #[tokio::test]
    async fn prune_before_drops_only_older_days() {
        let pool = memory_pool().await;
        reserve(&pool, "install-1", "2026-01-01").await.unwrap();
        reserve(&pool, "install-1", "2026-01-02").await.unwrap();
        let removed = prune_before(&pool, "2026-01-02").await.unwrap();
        assert_eq!(removed, 1);
        assert_eq!(
            used_today(&pool, "install-1", "2026-01-01").await.unwrap(),
            0
        );
        assert_eq!(
            used_today(&pool, "install-1", "2026-01-02").await.unwrap(),
            1
        );
    }
}
