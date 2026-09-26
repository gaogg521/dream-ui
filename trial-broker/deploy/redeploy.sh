#!/usr/bin/env bash
# Rebuild dream-trial-broker from source on the server and restart the service.
# Run ON the server, from a checkout at /root/build/dream-trial-broker (or pass
# the source dir as $1). Assumes the one-time `install.sh` has already run.
set -euo pipefail

SRC_DIR="${1:-/root/build/dream-trial-broker}"
APP_DIR=/opt/dream-trial-broker

command -v cargo >/dev/null || { echo "cargo not found; source \$HOME/.cargo/env"; exit 1; }

echo "==> building (release) in $SRC_DIR"
cd "$SRC_DIR"
cargo build --release -j2

echo "==> installing binary"
systemctl stop dream-trial-broker
install -m 0755 -o dreambroker -g dreambroker \
  "$SRC_DIR/target/release/dream-trial-broker" \
  "$APP_DIR/bin/dream-trial-broker"
strip "$APP_DIR/bin/dream-trial-broker" || true
systemctl start dream-trial-broker

sleep 2
systemctl --no-pager --full status dream-trial-broker | head -12
curl -sS -m 5 http://127.0.0.1:8787/internal/stats; echo
