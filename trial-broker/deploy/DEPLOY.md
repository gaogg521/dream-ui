# Deploying dream-trial-broker

No Docker. The broker is a single static-ish Rust binary fronted by an existing
nginx + Let's Encrypt setup, run under systemd. This mirrors how the other
services on the target box (`operone`) are deployed.

## Current production deployment (2026-08-28)

|                   |                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| Host              | `43.163.105.71` (Rocky Linux 10, Tencent Cloud)                                                    |
| Service user      | `dreambroker` (system, nologin)                                                                    |
| App dir           | `/opt/dream-trial-broker/` — `bin/`, `data/` (SQLite), `.env` (0600)                               |
| Listen            | `127.0.0.1:8787` (loopback only; not firewalled because not public)                                |
| Public URL        | `https://work.1oneclaw.com/trial-broker` (nginx location in `/etc/nginx/conf.d/1onework-www.conf`) |
| `/internal/stats` | returns 404 publicly; reachable only on `127.0.0.1:8787`                                           |
| systemd unit      | `/etc/systemd/system/dream-trial-broker.service` (copy of `deploy/systemd/`)                       |
| Source checkout   | `/root/build/dream-trial-broker` (+ rustup toolchain, for rebuilds)                                |

`DREAM_TRIAL_BROKER_URL` for dreamcore: **`https://work.1oneclaw.com/trial-broker`**
(dream-ui `packages/web-host` injects this as the default).

## First-time install

1. **Build.** Server has no Rust by default:

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
   source $HOME/.cargo/env
   git clone <repo> /root/build/dream-trial-broker   # or scp a source tarball
   cd /root/build/dream-trial-broker && cargo build --release -j2
   ```

2. **Install.** As root:

   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin dreambroker
   mkdir -p /opt/dream-trial-broker/{bin,data}
   install -m0755 target/release/dream-trial-broker /opt/dream-trial-broker/bin/

   umask 077
   cat > /opt/dream-trial-broker/.env <<'EOF'
   OPENROUTER_MANAGEMENT_KEY=sk-or-v1-REPLACE_ME
   DATABASE_URL=sqlite:///opt/dream-trial-broker/data/trial-broker.db
   LISTEN_ADDR=127.0.0.1:8787
   DAILY_BUDGET_USD_CAP=50.0
   TRIAL_KEY_LIMIT_USD=1.0
   TRIAL_KEY_EXPIRES_DAYS=90
   PER_IP_RATE_LIMIT_PER_HOUR=5
   RUST_LOG=dream_trial_broker=info,tower_http=info
   EOF
   chown -R dreambroker:dreambroker /opt/dream-trial-broker
   chmod 600 /opt/dream-trial-broker/.env

   cp deploy/systemd/dream-trial-broker.service /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now dream-trial-broker
   ```

3. **Expose via nginx.** Paste `deploy/nginx/trial-broker.location.conf` inside the
   `server { }` block of an already-TLS'd public host, then:

   ```bash
   nginx -t && systemctl reload nginx
   ```

   The `X-Real-IP` header the snippet sets (from nginx's own `$remote_addr`,
   not from anything the client sends) is what the broker's per-IP rate
   limiter reads (`src/routes.rs::extract_client_ip`). The broker does not
   trust `X-Forwarded-For` for this — nginx only appends to it
   (`$proxy_add_x_forwarded_for`), so a client could otherwise prepend an
   arbitrary address to it and spoof its way past the rate limiter. **Deploy
   the nginx snippet and the broker binary together**: if the broker is
   updated without the nginx config also setting `X-Real-IP`, every request
   falls back to the TCP peer address as seen by nginx itself — meaning if
   there's ever more than one hop in front of the broker, all callers would
   collapse onto that hop's IP and share one rate-limit bucket.

4. **Smoke test.**
   ```bash
   curl -s http://127.0.0.1:8787/internal/stats
   curl -s -X POST https://<host>/trial-broker/v1/trial-keys \
     -H 'content-type: application/json' -d '{"install_id":"smoke-1"}'
   # second call with the same install_id must return 409 already_issued
   ```

## Enabling mode C (hosted web search)

Mode C is off until the broker holds a search key, and turning it on is an
`.env` edit plus a restart — no rebuild, no client release:

```bash
umask 077
cat >> /opt/dream-trial-broker/.env <<'EOF'
SEARCH_TAVILY_API_KEY=tvly-REPLACE_ME
SEARCH_DAILY_LIMIT_PER_INSTALL=50
SEARCH_GLOBAL_DAILY_LIMIT=5000
SEARCH_RATE_LIMIT_PER_HOUR=60
EOF
systemctl restart dream-trial-broker
journalctl -u dream-trial-broker -n 20 | grep hosted_search   # expect true
```

Smoke test (a query under 2 characters is rejected before it leaves, so use a
real one):

```bash
curl -s -X POST https://<host>/trial-broker/v1/search   -H 'content-type: application/json'   -d '{"install_id":"smoke-1","query":"latest rust release","count":3}'
# expect {"provider":"tavily","results":[...],"quota":{...}}
```

The key is the whole point of this mode: it stays here because dream-ui is a
public repository and an Electron `asar` is readable, so a key shipped in the
app is a key published to everyone. Rotating it is an `.env` edit; rotating a
bundled one would have been a release.
Clean up test keys afterwards: list with
`GET https://openrouter.ai/api/v1/keys` (Bearer = management key), then
`DELETE https://openrouter.ai/api/v1/keys/{hash}` for each `onework-trial-*`,
and `rm /opt/dream-trial-broker/data/trial-broker.db*` + restart.

## Updating

```bash
# on the server, source dir refreshed (git pull / new tarball):
bash deploy/redeploy.sh /root/build/dream-trial-broker
```

## Operations

- Logs: `journalctl -u dream-trial-broker -f`
- Today's issuance count / remaining budget: `curl -s localhost:8787/internal/stats`
- Rotate the management key: edit `.env`, `systemctl restart dream-trial-broker`.
- Kill switch: `systemctl stop dream-trial-broker` — dreamcore then reports
  "could not reach trial key broker" and the desktop button surfaces a soft error.
