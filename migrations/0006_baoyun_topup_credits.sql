-- Local idempotency guard for crediting a real-money top-up order.
--
-- Baoyun's own order API has nothing like this: it settles the payment into
-- the shared account balance on its own, with no notion of "credit this
-- specific key" and no webhook -- callers are expected to poll
-- `GET /apis/v1/topup/orders/{id}` until it reports `success`. A poll that
-- observes `success` more than once (a client that keeps polling past the
-- first success, a retried request) must only apply `TokenVendor::top_up`
-- once per order. One row per order id, inserted the first time this broker
-- sees it settled, is that guard -- mirrors `metered_ledger_events`' use of
-- `order_id` for the same purpose in mode B, just without needing a whole
-- ledger table since mode A has no local balance to reconcile.
CREATE TABLE topup_credits (
  order_id    TEXT    NOT NULL PRIMARY KEY,
  vendor      TEXT    NOT NULL,
  install_id  TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  credited_at INTEGER NOT NULL
);
