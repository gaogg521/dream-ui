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

/// One credited real-money top-up. `vendor_key_handle` is the key that was
/// actually live *at credit time* (recorded directly on this row by
/// `crate::topup::credit_once` since migration 0007) — falling back to
/// whatever `issuances` says *now* only for rows credited before that
/// migration existed. This distinction matters once key recovery
/// (`crate::service::recover_deleted_key`) can rotate an install's handle:
/// without the direct column, every historical order for that install would
/// silently start pointing at the *new* key, which is wrong for "which key
/// did this specific payment fund." `None` only if neither source has it
/// (pre-0007 row whose issuance was since disabled/deleted).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TopupCredit {
    pub order_id: String,
    pub vendor: String,
    pub install_id: String,
    pub vendor_key_handle: Option<String>,
    pub amount: f64,
    pub credited_at: i64,
}

/// Lists credited top-ups for `vendor`, newest first — the reconciliation
/// view `/internal/topups` exists for: "who did this real-money payment
/// belong to." Optionally scoped to one `install_id` and/or one `order_id`.
/// The `order_id` filter is the direction Baoyun's own support pointed at:
/// their console's "交易号" (transaction number) column *is* the id this
/// broker got back from `create_topup_order` — an operator staring at one
/// unfamiliar row in Baoyun's wallet page can paste that id here to find out
/// whose it was, without scanning every credited row by eye.
///
/// Only rows that made it into `topup_credits` appear here (i.e. orders that
/// actually settled and were credited) — a `pending`/`failed`/`expired`
/// order was never inserted, so it has nothing to show here by design; those
/// still show up in the vendor's own payment console, just not attributable
/// to an install there.
pub async fn list_topup_credits(
    pool: &SqlitePool,
    vendor: &str,
    install_id: Option<&str>,
    order_id: Option<&str>,
) -> sqlx::Result<Vec<TopupCredit>> {
    sqlx::query_as::<_, TopupCredit>(
        "SELECT tc.order_id, tc.vendor, tc.install_id,
                COALESCE(tc.vendor_key_handle, i.vendor_key_handle) AS vendor_key_handle,
                tc.amount, tc.credited_at
         FROM topup_credits tc
         LEFT JOIN issuances i ON i.vendor = tc.vendor AND i.install_id = tc.install_id
         WHERE tc.vendor = ?
           AND (? IS NULL OR tc.install_id = ?)
           AND (? IS NULL OR tc.order_id = ?)
         ORDER BY tc.credited_at DESC",
    )
    .bind(vendor)
    .bind(install_id)
    .bind(install_id)
    .bind(order_id)
    .bind(order_id)
    .fetch_all(pool)
    .await
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

/// Re-points an existing issuance at a freshly issued replacement key — used
/// when the original was confirmed gone on the vendor's side (see
/// `crate::service::recover_deleted_key`). Updates the row in place rather
/// than inserting a second one: `issuances` has a `UNIQUE (vendor,
/// install_id)` constraint, so there can only ever be one row per install
/// per vendor regardless of `disabled`, live or not.
pub async fn replace_issuance_key(
    pool: &SqlitePool,
    issuance_id: &str,
    new_vendor_key_handle: &str,
    issued_at: i64,
    expires_at: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE issuances SET vendor_key_handle = ?, issued_at = ?, expires_at = ?, disabled = 0 \
         WHERE id = ?",
    )
    .bind(new_vendor_key_handle)
    .bind(issued_at)
    .bind(expires_at)
    .bind(issuance_id)
    .execute(pool)
    .await?;

    Ok(())
}
