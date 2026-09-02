//! Persistence for mode B: the account balance, its audit ledger, top-up
//! orders, and the async-cost retry queue.
//!
//! Every read-modify-write here runs inside a transaction. The pool is
//! deliberately capped at one connection (see [`crate::db::init_pool`]), so a
//! transaction holds the only connection for its whole lifetime and the
//! read-then-write cannot interleave with another task — the same guarantee
//! `BEGIN IMMEDIATE` would give under a multi-connection pool, which is the
//! upgrade path if that cap is ever lifted.

use sqlx::SqlitePool;
use uuid::Uuid;

/// The fast-path balance row. The invariant it must always satisfy:
/// `remaining = free_grant_cents + purchased_cents - consumed_cents`, and that
/// must reconcile to the sum of `metered_ledger_events`.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MeteredAccount {
    pub vendor: String,
    pub install_id: String,
    pub device_token_hash: String,
    pub free_grant_cents: i64,
    pub purchased_cents: i64,
    pub consumed_cents: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl MeteredAccount {
    pub fn remaining_cents(&self) -> i64 {
        self.free_grant_cents + self.purchased_cents - self.consumed_cents
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MeteredOrder {
    pub id: String,
    pub vendor: String,
    pub install_id: String,
    pub package_id: String,
    pub amount_cents: i64,
    pub credit_cents: i64,
    pub status: String,
    pub gateway: String,
    pub gateway_txn_id: Option<String>,
    pub created_at: i64,
    pub paid_at: Option<i64>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PendingCost {
    pub request_id: String,
    pub vendor: String,
    pub install_id: String,
    pub task_id: Option<String>,
    pub attempts: i64,
    pub created_at: i64,
    pub next_attempt_at: i64,
}

/// Outcome of a `claim`: whether the free grant was handed out this call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaimResult {
    /// `true` on the first claim for a `(vendor, install_id)` — the free grant
    /// was applied. `false` on a repeat claim — only the device token rotated,
    /// no credit moved.
    pub fresh_grant: bool,
}

/// Outcome of crediting a paid order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreditOutcome {
    /// Order marked paid and `credit_cents` added to the balance this call.
    Credited { credit_cents: i64 },
    /// The order was already paid and credited; nothing changed.
    AlreadySettled,
    /// No order with that id.
    UnknownOrder,
}

const ACCOUNT_COLUMNS: &str = "vendor, install_id, device_token_hash, free_grant_cents, \
     purchased_cents, consumed_cents, created_at, updated_at";
const ORDER_COLUMNS: &str = "id, vendor, install_id, package_id, amount_cents, credit_cents, \
     status, gateway, gateway_txn_id, created_at, paid_at";

/// First claim: create the account and apply the one-time free grant.
/// Repeat claim: rotate the stored device-token hash only, leaving every
/// balance field untouched — so reinstalling the app cannot re-mint free
/// credit, but a returning device still gets a working token.
pub async fn claim(
    pool: &SqlitePool,
    vendor: &str,
    install_id: &str,
    device_token_hash: &str,
    free_grant_cents: i64,
    now_ms: i64,
) -> sqlx::Result<ClaimResult> {
    let mut tx = pool.begin().await?;

    let exists: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM metered_accounts WHERE vendor = ? AND install_id = ?")
            .bind(vendor)
            .bind(install_id)
            .fetch_optional(&mut *tx)
            .await?;

    let fresh_grant = if exists.is_some() {
        sqlx::query(
            "UPDATE metered_accounts SET device_token_hash = ?, updated_at = ? \
             WHERE vendor = ? AND install_id = ?",
        )
        .bind(device_token_hash)
        .bind(now_ms)
        .bind(vendor)
        .bind(install_id)
        .execute(&mut *tx)
        .await?;
        false
    } else {
        sqlx::query(
            "INSERT INTO metered_accounts \
             (vendor, install_id, device_token_hash, free_grant_cents, purchased_cents, \
              consumed_cents, created_at, updated_at) \
             VALUES (?, ?, ?, ?, 0, 0, ?, ?)",
        )
        .bind(vendor)
        .bind(install_id)
        .bind(device_token_hash)
        .bind(free_grant_cents)
        .bind(now_ms)
        .bind(now_ms)
        .execute(&mut *tx)
        .await?;

        if free_grant_cents > 0 {
            insert_ledger_event(
                &mut tx,
                vendor,
                install_id,
                "free_grant",
                free_grant_cents,
                None,
                None,
                now_ms,
            )
            .await?;
        }
        true
    };

    tx.commit().await?;
    Ok(ClaimResult { fresh_grant })
}

pub async fn find_account_by_token(
    pool: &SqlitePool,
    vendor: &str,
    device_token_hash: &str,
) -> sqlx::Result<Option<MeteredAccount>> {
    sqlx::query_as::<_, MeteredAccount>(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM metered_accounts \
         WHERE vendor = ? AND device_token_hash = ?"
    ))
    .bind(vendor)
    .bind(device_token_hash)
    .fetch_optional(pool)
    .await
}

pub async fn get_account(
    pool: &SqlitePool,
    vendor: &str,
    install_id: &str,
) -> sqlx::Result<Option<MeteredAccount>> {
    sqlx::query_as::<_, MeteredAccount>(&format!(
        "SELECT {ACCOUNT_COLUMNS} FROM metered_accounts WHERE vendor = ? AND install_id = ?"
    ))
    .bind(vendor)
    .bind(install_id)
    .fetch_optional(pool)
    .await
}

/// Records a settled charge and decrements the balance, atomically and exactly
/// once per `request_id`. Returns `true` if this call applied it, `false` if a
/// prior writer already did (the proxy's inline billing task and the poller
/// can both reach the same id).
pub async fn apply_consume(
    pool: &SqlitePool,
    vendor: &str,
    install_id: &str,
    request_id: &str,
    amount_cents: i64,
    now_ms: i64,
) -> sqlx::Result<bool> {
    let mut tx = pool.begin().await?;

    let inserted = sqlx::query(
        "INSERT INTO metered_ledger_events \
         (id, vendor, install_id, kind, amount_cents, request_id, created_at) \
         VALUES (?, ?, ?, 'consume', ?, ?, ?) \
         ON CONFLICT DO NOTHING",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(vendor)
    .bind(install_id)
    .bind(amount_cents)
    .bind(request_id)
    .bind(now_ms)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;

    if inserted && amount_cents != 0 {
        sqlx::query(
            "UPDATE metered_accounts SET consumed_cents = consumed_cents + ?, updated_at = ? \
             WHERE vendor = ? AND install_id = ?",
        )
        .bind(amount_cents)
        .bind(now_ms)
        .bind(vendor)
        .bind(install_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(inserted)
}

// --- pending async costs ---------------------------------------------------

pub async fn enqueue_pending(
    pool: &SqlitePool,
    vendor: &str,
    install_id: &str,
    request_id: &str,
    task_id: Option<&str>,
    now_ms: i64,
    next_attempt_at: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO metered_pending_costs \
         (request_id, vendor, install_id, task_id, attempts, created_at, next_attempt_at) \
         VALUES (?, ?, ?, ?, 0, ?, ?) \
         ON CONFLICT DO NOTHING",
    )
    .bind(request_id)
    .bind(vendor)
    .bind(install_id)
    .bind(task_id)
    .bind(now_ms)
    .bind(next_attempt_at)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn due_pending(
    pool: &SqlitePool,
    now_ms: i64,
    limit: i64,
) -> sqlx::Result<Vec<PendingCost>> {
    sqlx::query_as::<_, PendingCost>(
        "SELECT request_id, vendor, install_id, task_id, attempts, created_at, next_attempt_at \
         FROM metered_pending_costs WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?",
    )
    .bind(now_ms)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn delete_pending(pool: &SqlitePool, request_id: &str) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM metered_pending_costs WHERE request_id = ?")
        .bind(request_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn bump_pending(
    pool: &SqlitePool,
    request_id: &str,
    next_attempt_at: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE metered_pending_costs SET attempts = attempts + 1, next_attempt_at = ? \
         WHERE request_id = ?",
    )
    .bind(next_attempt_at)
    .bind(request_id)
    .execute(pool)
    .await?;
    Ok(())
}

// --- orders --------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub async fn create_order(
    pool: &SqlitePool,
    id: &str,
    vendor: &str,
    install_id: &str,
    package_id: &str,
    amount_cents: i64,
    credit_cents: i64,
    gateway: &str,
    now_ms: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO metered_orders \
         (id, vendor, install_id, package_id, amount_cents, credit_cents, status, gateway, \
          gateway_txn_id, created_at, paid_at) \
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, NULL)",
    )
    .bind(id)
    .bind(vendor)
    .bind(install_id)
    .bind(package_id)
    .bind(amount_cents)
    .bind(credit_cents)
    .bind(gateway)
    .bind(now_ms)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_order(pool: &SqlitePool, id: &str) -> sqlx::Result<Option<MeteredOrder>> {
    sqlx::query_as::<_, MeteredOrder>(&format!(
        "SELECT {ORDER_COLUMNS} FROM metered_orders WHERE id = ?"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn set_order_gateway_txn(
    pool: &SqlitePool,
    id: &str,
    gateway_txn_id: &str,
) -> sqlx::Result<()> {
    sqlx::query("UPDATE metered_orders SET gateway_txn_id = ? WHERE id = ?")
        .bind(gateway_txn_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Marks an order paid and credits its `credit_cents` to the balance — once,
/// however many times a gateway redelivers the callback (idempotent on
/// `order_id` via the ledger's partial unique index).
pub async fn mark_order_paid_and_credit(
    pool: &SqlitePool,
    order_id: &str,
    gateway_txn_id: Option<&str>,
    now_ms: i64,
) -> sqlx::Result<CreditOutcome> {
    let mut tx = pool.begin().await?;

    let Some(order) = sqlx::query_as::<_, MeteredOrder>(&format!(
        "SELECT {ORDER_COLUMNS} FROM metered_orders WHERE id = ?"
    ))
    .bind(order_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        tx.commit().await?;
        return Ok(CreditOutcome::UnknownOrder);
    };

    if order.status == "paid" {
        tx.commit().await?;
        return Ok(CreditOutcome::AlreadySettled);
    }

    sqlx::query(
        "UPDATE metered_orders SET status = 'paid', gateway_txn_id = COALESCE(?, gateway_txn_id), \
         paid_at = ? WHERE id = ?",
    )
    .bind(gateway_txn_id)
    .bind(now_ms)
    .bind(order_id)
    .execute(&mut *tx)
    .await?;

    let credited = sqlx::query(
        "INSERT INTO metered_ledger_events \
         (id, vendor, install_id, kind, amount_cents, order_id, created_at) \
         VALUES (?, ?, ?, 'purchase', ?, ?, ?) \
         ON CONFLICT DO NOTHING",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&order.vendor)
    .bind(&order.install_id)
    .bind(order.credit_cents)
    .bind(order_id)
    .bind(now_ms)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;

    if credited {
        sqlx::query(
            "UPDATE metered_accounts SET purchased_cents = purchased_cents + ?, updated_at = ? \
             WHERE vendor = ? AND install_id = ?",
        )
        .bind(order.credit_cents)
        .bind(now_ms)
        .bind(&order.vendor)
        .bind(&order.install_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(CreditOutcome::Credited {
        credit_cents: order.credit_cents,
    })
}

#[allow(clippy::too_many_arguments)]
async fn insert_ledger_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    vendor: &str,
    install_id: &str,
    kind: &str,
    amount_cents: i64,
    request_id: Option<&str>,
    order_id: Option<&str>,
    now_ms: i64,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO metered_ledger_events \
         (id, vendor, install_id, kind, amount_cents, request_id, order_id, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(vendor)
    .bind(install_id)
    .bind(kind)
    .bind(amount_cents)
    .bind(request_id)
    .bind(order_id)
    .bind(now_ms)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
