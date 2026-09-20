use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

/// A single row in the `issuances` table. `disabled` is stored as an
/// integer (0/1) since that's SQLite's native boolean representation.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Issuance {
    pub id: String,
    /// Which upstream platform minted this key (`TokenVendor::id`).
    pub vendor: String,
    pub install_id: String,
    pub ip: String,
    /// The vendor's own opaque identifier for the key. Not the key itself —
    /// the plaintext is returned once, at creation, and never stored.
    pub vendor_key_handle: String,
    pub issued_at: i64,
    pub expires_at: i64,
    pub disabled: i64,
}

/// Opens the pool and runs migrations. A single connection is used
/// deliberately: this is a low-volume service, and it sidesteps SQLite's
/// "many connections = separate in-memory databases" footgun entirely
/// (relevant for `sqlite::memory:` in tests, harmless for a file DB in prod).
pub async fn init_pool(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)?.create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

const COLUMNS: &str =
    "id, vendor, install_id, ip, vendor_key_handle, issued_at, expires_at, disabled";

/// Looks up a non-disabled issuance for this install on this vendor (dedup
/// check). Scoped per vendor: one device may hold one key per platform.
pub async fn find_active_by_install_id(
    pool: &SqlitePool,
    vendor: &str,
    install_id: &str,
) -> sqlx::Result<Option<Issuance>> {
    sqlx::query_as::<_, Issuance>(&format!(
        "SELECT {COLUMNS} FROM issuances
         WHERE vendor = ? AND install_id = ? AND disabled = 0"
    ))
    .bind(vendor)
    .bind(install_id)
    .fetch_optional(pool)
    .await
}

/// Counts issuances on `vendor` that are active (not expired as of `now_ms`,
/// not disabled) and were issued at or after `since_ms`. Used both by the
/// daily circuit breaker and the `/internal/stats` endpoint.
///
/// Scoped per vendor: each vendor's per-key limit is in its own currency, so
/// a global count would sum liability across currencies into one meaningless
/// number and let one vendor's budget gate another's issuance.
pub async fn count_active_issued_since(
    pool: &SqlitePool,
    vendor: &str,
    since_ms: i64,
    now_ms: i64,
) -> sqlx::Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM issuances
         WHERE vendor = ? AND issued_at >= ? AND expires_at > ? AND disabled = 0",
    )
    .bind(vendor)
    .bind(since_ms)
    .bind(now_ms)
    .fetch_one(pool)
    .await?;

    Ok(count)
}

pub async fn insert_issuance(pool: &SqlitePool, issuance: &Issuance) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO issuances (id, vendor, install_id, ip, vendor_key_handle, issued_at, expires_at, disabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&issuance.id)
    .bind(&issuance.vendor)
    .bind(&issuance.install_id)
    .bind(&issuance.ip)
    .bind(&issuance.vendor_key_handle)
    .bind(issuance.issued_at)
    .bind(issuance.expires_at)
    .bind(issuance.disabled)
    .execute(pool)
    .await?;

    Ok(())
}
