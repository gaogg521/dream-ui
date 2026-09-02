# dream-trial-broker

Standalone Rust service that gives first-time desktop-app users a free trial
allowance on an upstream LLM platform. It runs two independent billing models
side by side:

- **Mode A — issued key** (`/v1/trial-keys`, `/v1/quota/status`): holds the
  company's OpenRouter Management Key and mints a brand-new capped-spend
  sub-key. The broker is out of the inference path — the caller talks to
  OpenRouter directly.
- **Mode B — metered proxy** (`/v1/metered/*`): for a vendor that cannot cap a
  key (e.g. Baoyun). The broker forwards inference under one master key,
  streams the response back, and bills each call against a local CNY ledger,
  hard-blocking at zero. Top-ups are bought through a payment gateway
  (`MockGateway` only, so far — see the handoff doc). Disabled unless
  `BAOYUN_MASTER_API_KEY` is set.

The two modes share no code and no tables. Design and status:
[`docs/baoyun-metered-proxy-handoff.zh-CN.md`](docs/baoyun-metered-proxy-handoff.zh-CN.md).

This is a fully independent project (its own git repo, its own
`Cargo.toml`), not part of any workspace with `dream-core` / `dream-ui` /
`dream-engine`.

## Deployment

Live since 2026-08-28 at **`https://work.1oneclaw.com/trial-broker`**
(host `43.163.105.71`, systemd, no Docker). dreamcore reaches it via
`DREAM_TRIAL_BROKER_URL`, which dream-ui `packages/web-host` now defaults to
that URL. Full runbook: [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## Tech stack

Rust, Axum, sqlx (SQLite), reqwest, tokio, serde, tracing.

## Running locally

1. Copy `.env.example` to `.env` and fill in `OPENROUTER_MANAGEMENT_KEY`
   with a real OpenRouter Management Key (never commit this file).
2. `cargo run`

The service listens on `LISTEN_ADDR` (default `0.0.0.0:8787`) and creates /
migrates a local SQLite file at `DATABASE_URL` (default
`sqlite://trial-broker.db`) on startup.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENROUTER_MANAGEMENT_KEY` | yes | — | Secret. Never logged. |
| `DATABASE_URL` | no | `sqlite://trial-broker.db` | sqlx SQLite connection URL. |
| `DAILY_BUDGET_USD_CAP` | no | `50.0` | Circuit breaker on *new liability handed out per day* — at the defaults, at most 50 new trial users per day. |
| `TRIAL_KEY_LIMIT_USD` | no | `1.0` | Per-key USD spend cap sent to OpenRouter, per reset period. |
| `TRIAL_KEY_LIMIT_RESET` | no | `monthly` | `monthly` or `daily`. `monthly` caps each trial user at $1/month; `daily` would allow ~$30/month each. Rejected at startup if it is anything else. |
| `TRIAL_KEY_EXPIRES_DAYS` | no | `90` | Key lifetime from issuance. |
| `LISTEN_ADDR` | no | `0.0.0.0:8787` | HTTP bind address. |
| `PER_IP_RATE_LIMIT_PER_HOUR` | no | `5` | In-memory sliding-window cap per caller IP. |
| `PUBLIC_BASE_URL` | no | `http://<LISTEN_ADDR>` | The broker's own external base URL, used to build mode B's client proxy URL. Set in production. |
| `BAOYUN_MASTER_API_KEY` | no | — | Secret. Enables the mode B `baoyun` vendor when set; mode B is off otherwise. |
| `BAOYUN_BASE_URL` | no | `https://ai-api.baoyun.com` | Baoyun upstream origin. |
| `BAOYUN_FREE_GRANT_CENTS` | no | `1000` | One-time free grant, CNY cents (`1000` = ¥10.00). |
| `BAOYUN_TRIAL_MODELS` | no | placeholder | Comma-separated preset model list; unset serves an unverified placeholder. |
| `MOCK_GATEWAY_SECRET` | no | `mock-secret` | Shared secret the mock payment webhook body must carry. |

## API

### `POST /v1/trial-keys`

Request:

```json
{ "install_id": "opaque-per-device-id" }
```

Success response (`200`):

```json
{
  "key": "sk-or-v1-....",
  "base_url": "https://openrouter.ai/api/v1",
  "models": [
    "openrouter/free",
    "openrouter/auto-beta",
    "~deepseek/deepseek-v4-flash-latest"
  ]
}
```

Error responses:

| Status | Body | Cause |
|---|---|---|
| 400 | `{"error":"bad_request"}` | Missing/empty `install_id`. |
| 409 | `{"error":"already_issued"}` | This `install_id` already has an active key. |
| 429 | `{"error":"rate_limited"}` | Caller IP exceeded `PER_IP_RATE_LIMIT_PER_HOUR`. |
| 502 | `{"error":"upstream_error"}` | OpenRouter's create-key call failed. |
| 503 | `{"error":"daily_budget_exhausted"}` | Today's estimated liability hit `DAILY_BUDGET_USD_CAP`. |
| 500 | `{"error":"internal_error"}` | Unexpected server/database error. |

### Mode B — metered proxy (`/v1/metered/*`)

Every route 404s unless a metered vendor is configured. Amounts are integer
CNY cents (分).

| Method & path | Purpose |
|---|---|
| `POST /v1/metered/claim` | `{vendor, install_id}` → creates the account, applies the one-time free grant (first claim only), returns `{base_url, device_token, models, currency, free_grant_cents, remaining_cents}`. `base_url` is the broker's own proxy address. The `device_token` is returned once and rotates on every claim. |
| `ANY /v1/metered/proxy/{vendor}/*path` | Inference forwarding. Bearer = `device_token`. Balance ≤ 0 → `402 {"code":"QUOTA_EXHAUSTED"}`. Otherwise the client bearer is swapped for the vendor master key, the response (including SSE) is streamed straight back, and the call is billed afterwards from `GET /v1/billing/cost`. |
| `POST /v1/metered/quota/status` | `{vendor, install_id}` → local ledger balance `{free_grant_cents, purchased_cents, consumed_cents, remaining_cents, exhausted}`. |
| `POST /v1/metered/orders` | `{vendor, install_id, package_id}` → creates a pending top-up order and returns the gateway pay instructions in `payment`. |
| `GET /v1/metered/orders/{id}` | Poll one order's status. |
| `POST /v1/metered/orders/webhook/{gateway}` | Gateway callback; on a verified paid event, credits the order's `credit_cents` once. |

Async (image / video) calls that can't be priced inline are settled by a
background poller against `metered_pending_costs`.

### `GET /internal/stats`

Manually-checked ops endpoint, no auth. Returns:

```json
{
  "issued_today": 3,
  "issuance_budget_cap_usd": 50.0,
  "liability_added_today_usd": 3.0,
  "per_key_limit_usd": 1.0,
  "per_key_limit_reset": "monthly"
}
```

`liability_added_today_usd` is liability *created* today, not spend incurred:
each key issued today may spend up to `per_key_limit_usd` per
`per_key_limit_reset` period for as long as it lives.

## Data model

SQLite, `migrations/`.

- Mode A: `issuances` (`0001`, `0002`). The plaintext key is never stored —
  only the vendor's handle for it.
- Mode B: `metered_accounts` (fast-path balance), `metered_ledger_events`
  (append-only audit trail that must reconcile to it), `metered_orders`,
  `metered_pending_costs` (`0003`). Device tokens are stored only as a
  SHA-256 hash.

## Testing

```
cargo test
```

In-memory SQLite throughout. Mode A tests mock the OpenRouter client
(`tests/trial_keys.rs`); mode B tests run the real router against a stand-in
upstream server and a scripted cost resolver (`tests/metered.rs`) — no real
network calls.
