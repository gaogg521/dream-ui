-- Mode B: metered proxy.
--
-- A second, fully independent billing model living in the same process as the
-- mode-A `issuances` table. Mode A mints a capped sub-key on the vendor and
-- steps out of the inference path; mode B keeps the broker *in* the path,
-- forwards every request under one master key, and enforces the cap against a
-- local ledger. Nothing here references `issuances`, and no mode-A code
-- references these tables.
--
-- Money is involved, so the balance is never a single mutable field on its
-- own: `metered_accounts` carries the fast-path balance, `metered_ledger_events`
-- is the append-only audit trail that must always reconcile to it
--   remaining = free_grant_cents + purchased_cents - consumed_cents
-- All amounts are integer CNY cents (分).

CREATE TABLE metered_accounts (
  vendor            TEXT    NOT NULL,
  install_id        TEXT    NOT NULL,
  -- The device token is returned in plaintext exactly once per claim and only
  -- its SHA-256 hex is stored, matching the mode-A "never persist the secret"
  -- rule.
  device_token_hash TEXT    NOT NULL,
  free_grant_cents  INTEGER NOT NULL DEFAULT 0,  -- granted once, never restored by spend
  purchased_cents   INTEGER NOT NULL DEFAULT 0,  -- sum of every paid order
  consumed_cents    INTEGER NOT NULL DEFAULT 0,  -- sum of every settled proxy call
  created_at        INTEGER NOT NULL,            -- unix ms
  updated_at        INTEGER NOT NULL,            -- unix ms
  PRIMARY KEY (vendor, install_id)
);

-- Proxy auth resolves a bearer token to an account by this hash.
CREATE INDEX idx_metered_accounts_token ON metered_accounts (vendor, device_token_hash);

CREATE TABLE metered_ledger_events (
  id           TEXT    PRIMARY KEY,
  vendor       TEXT    NOT NULL,
  install_id   TEXT    NOT NULL,
  kind         TEXT    NOT NULL,  -- 'free_grant' | 'purchase' | 'consume' | 'refund'
  amount_cents INTEGER NOT NULL,  -- always a positive magnitude; `kind` gives the direction
  request_id   TEXT,              -- kind='consume': the vendor's X-AiHub-Request-Id, for reconciliation
  order_id     TEXT,              -- kind='purchase': the metered_orders.id it settled
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_metered_ledger_account ON metered_ledger_events (vendor, install_id, created_at);

-- One settled charge per upstream request id. The proxy's post-response
-- billing task and the pending-cost poller can both reach the same request id;
-- this index makes the second writer a no-op instead of a double charge.
CREATE UNIQUE INDEX idx_metered_ledger_consume_request
  ON metered_ledger_events (request_id) WHERE kind = 'consume';

-- One credit per paid order, however many times a gateway redelivers its
-- webhook.
CREATE UNIQUE INDEX idx_metered_ledger_purchase_order
  ON metered_ledger_events (order_id) WHERE kind = 'purchase';

CREATE TABLE metered_orders (
  id             TEXT    PRIMARY KEY,
  vendor         TEXT    NOT NULL,
  install_id     TEXT    NOT NULL,
  package_id     TEXT    NOT NULL,   -- '59' | '99' | '199'
  amount_cents   INTEGER NOT NULL,   -- what the user pays
  credit_cents   INTEGER NOT NULL,   -- what lands in the balance (1:1 for now; see handoff doc open questions)
  status         TEXT    NOT NULL,   -- 'pending' | 'paid' | 'failed' | 'expired'
  gateway        TEXT    NOT NULL,   -- 'alipay' | 'wechat' | 'mock'
  gateway_txn_id TEXT,
  created_at     INTEGER NOT NULL,
  paid_at        INTEGER
);

CREATE INDEX idx_metered_orders_account ON metered_orders (vendor, install_id, created_at);

-- Async jobs (image / video) can only be priced once they reach a terminal
-- state, so the proxy cannot bill them inline without stalling the caller.
-- It drops the request id here and a background poller settles it later.
CREATE TABLE metered_pending_costs (
  request_id  TEXT    PRIMARY KEY,   -- the vendor's X-AiHub-Request-Id
  vendor      TEXT    NOT NULL,
  install_id  TEXT    NOT NULL,
  task_id     TEXT,                  -- async task id, when the response carried one
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL   -- unix ms; poller skips rows not yet due
);

CREATE INDEX idx_metered_pending_due ON metered_pending_costs (next_attempt_at);
