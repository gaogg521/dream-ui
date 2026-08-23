#!/bin/bash
# Build the Docker image from an already-staged aionui-web tree and verify
# the container actually serves the app end-to-end. This is the check that
# would have caught the previous Dockerfile being broken from the day it was
# added (it referenced a build script that had already been deleted, and
# `docker build` was never run in CI to notice).
#
# Usage: scripts/smoke-test-docker.sh
# Expects dist-web-cli/staging/aionui-web/ to already exist (see Dockerfile's
# header comment / scripts/pack-web-cli.js).
set -e

STAGING_DIR="dist-web-cli/staging/aionui-web"
if [ ! -d "$STAGING_DIR" ]; then
  echo "❌ $STAGING_DIR not found — run scripts/pack-web-cli.js first"
  exit 1
fi

IMAGE_TAG="aionui-web:smoke-test"
CONTAINER_NAME="aionui-web-smoke-test"
HOST_PORT=25810

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "========================================"
echo "Docker smoke test"
echo "========================================"

echo ""
echo "1. Building image..."
docker build -t "$IMAGE_TAG" .

echo ""
echo "2. Starting container..."
cleanup
docker run -d --name "$CONTAINER_NAME" -p "${HOST_PORT}:25808" "$IMAGE_TAG"

echo ""
echo "3. Waiting for /api/auth/status to respond..."
READY=""
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${HOST_PORT}/api/auth/status" >/tmp/docker-smoke-status.json 2>/dev/null; then
    READY=1
    break
  fi
  sleep 1
done

if [ -z "$READY" ]; then
  echo "❌ /api/auth/status never came up. Container logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi
echo "✓ /api/auth/status responded: $(cat /tmp/docker-smoke-status.json)"

echo ""
echo "4. Checking Docker HEALTHCHECK reports healthy..."
HEALTHY=""
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "")
  if [ "$STATUS" = "healthy" ]; then
    HEALTHY=1
    break
  fi
  sleep 2
done
if [ -z "$HEALTHY" ]; then
  echo "❌ Container never reported healthy (last status: ${STATUS:-unknown}). Logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi
echo "✓ Container healthcheck: healthy"

echo ""
echo "5. Verifying first-run admin password + login round-trip..."
PASSWORD=$(docker logs "$CONTAINER_NAME" 2>&1 | grep -oE 'Generated initial admin password: [^ ]+' | head -1 | sed 's/^Generated initial admin password: //')
if [ -z "$PASSWORD" ]; then
  echo "❌ Never saw 'Generated initial admin password' in container logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi
echo "✓ Captured initial admin password from container logs"

LOGIN_BODY=$(printf '{"username":"admin","password":"%s","remember":false}' "$PASSWORD")
HTTP_CODE=$(curl -sS -o /tmp/docker-smoke-login.json -w '%{http_code}' \
  -X POST "http://127.0.0.1:${HOST_PORT}/login" \
  -H 'Content-Type: application/json' \
  --data "$LOGIN_BODY" || echo "000")

if [ "$HTTP_CODE" != "200" ] || ! grep -q '"success":[[:space:]]*true' /tmp/docker-smoke-login.json; then
  echo "❌ /login failed (HTTP $HTTP_CODE):"
  cat /tmp/docker-smoke-login.json
  docker logs "$CONTAINER_NAME"
  exit 1
fi
echo "✓ Login with printed password succeeded (HTTP 200)"

echo ""
echo "6. Verifying resetpass CLI works via docker exec (the operator escape hatch)..."
# --data-dir is a top-level flag on the Cli struct, not `global = true` —
# clap only accepts it BEFORE the subcommand name. `resetpass --data-dir`
# fails with "unexpected argument '--data-dir' found" (exit 2); confirmed
# locally and is exactly what broke this step the first time this script
# ran in CI.
# Plain assignment from a failing command substitution trips `set -e`
# immediately (before the `if` below ever runs) and prints nothing but a bare
# "exit code N" — exactly what happened when the flag order above was still
# wrong. `|| true` keeps the real output reachable for the diagnostic below.
RESETPASS_OUT=$(docker exec "$CONTAINER_NAME" ./bundled-aioncore/linux-x64/aioncore --data-dir /data resetpass 2>&1) || true
if ! echo "$RESETPASS_OUT" | grep -q "New password:"; then
  echo "❌ resetpass did not print a new password:"
  echo "$RESETPASS_OUT"
  exit 1
fi
echo "✓ resetpass works via docker exec"

echo ""
echo "========================================"
echo "✅ Docker smoke test passed!"
echo "========================================"
