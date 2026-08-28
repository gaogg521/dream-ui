# dream-trial-broker

Standalone Rust service that holds the company's OpenRouter "Management Key"
and exposes a single endpoint for minting brand-new, capped-spend OpenRouter
API keys for first-time users of the desktop app. This broker never proxies
model traffic — it only issues keys, which the caller's machine then uses to
talk to OpenRouter directly.

This is a fully independent project (its own git repo, its own
`Cargo.toml`), not part of any workspace with `dream-core` / `dream-ui` /
`dream-engine`.

## Deployment

Live since 2026-08-28 at **`https://work.1oneclaw.com/trial-broker`**
(host `43.163.105.71`, systemd, no Docker). aioncore reaches it via
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
| `DAILY_BUDGET_USD_CAP` | no | `50.0` | Circuit breaker: stop issuing once today's estimated liability hits this. |
| `TRIAL_KEY_LIMIT_USD` | no | `1.0` | Per-key USD spend cap sent to OpenRouter. |
| `TRIAL_KEY_EXPIRES_DAYS` | no | `90` | Key lifetime from issuance. |
| `LISTEN_ADDR` | no | `0.0.0.0:8787` | HTTP bind address. |
| `PER_IP_RATE_LIMIT_PER_HOUR` | no | `5` | In-memory sliding-window cap per caller IP. |

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
    "deepseek/deepseek-chat",
    "qwen/qwen-2.5-72b-instruct",
    "google/gemini-2.0-flash-001"
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

### `GET /internal/stats`

Manually-checked ops endpoint, no auth. Returns:

```json
{
  "issued_today": 3,
  "budget_cap_usd": 50.0,
  "estimated_daily_liability_usd": 3.0
}
```

## Data model

Single SQLite table `issuances` (see `migrations/0001_init.sql`). The
plaintext OpenRouter key is never stored — only its SHA-256 hash.

## Testing

```
cargo test
```

Tests use an in-memory SQLite database and a mocked OpenRouter client (see
`tests/trial_keys.rs`) — no real network calls are made.
