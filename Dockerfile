# syntax=docker/dockerfile:1
#
# Packages the already-built `aionui-web` tarball (Rust `aioncore` + Bun-
# compiled `aionui-web` launcher + SPA static assets) into a runtime image.
#
# This Dockerfile does NOT compile Rust or TypeScript — that already happens
# in CI (`.github/workflows/pack-web-cli.yml`, `scripts/pack-web-cli.js`) and
# is smoke-tested there. Re-running the whole cross-compile toolchain inside
# `docker build` would just duplicate that work and make the image slower to
# build and harder to reproduce. Instead, build the staging directory first:
#
#   PACK_PLATFORM=linux PACK_ARCH=x64 node scripts/pack-web-cli.js
#   docker build -t aionui-web .
#
# `pack-web-cli.js` leaves the exact tree this image needs at
# `dist-web-cli/staging/aionui-web/` (see that script for the full layout).
# For a local backend build (no GitHub release needed), point it at your own
# binary first: `export AIONUI_BACKEND_LOCAL_PATH=/path/to/aioncore`.
FROM debian:bookworm-slim

# ca-certificates: aioncore calls out to model provider APIs over HTTPS.
# curl: used by the HEALTHCHECK below.
# libicu-dev: the officecli helper (`crates/aionui-office`, spawned by
# aioncore itself — Office document preview/conversion, not an Electron
# thing) is a self-contained .NET binary that aborts on startup without ICU,
# and Debian slim images don't ship it. libicu-dev is version-agnostic so it
# keeps resolving the right libicuNN as the base image's Debian release
# changes, instead of us hardcoding a soname.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libicu-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Staged by `scripts/pack-web-cli.js` (see header comment above) — already
# contains the compiled `aionui-web` binary, `bundled-aioncore/linux-x64/`,
# and the SPA `static/` assets. Nothing to build here, only to place.
COPY dist-web-cli/staging/aionui-web/ ./
RUN chmod +x ./aionui-web ./bundled-aioncore/linux-x64/aioncore

# AIONUI_ALLOW_REMOTE is not optional here: without it aionui-web binds its
# HTTP listener to 127.0.0.1 and the container is unreachable from outside
# itself no matter what port mapping the host uses
# (packages/web-host/src/static-server.ts:392-393). Real per-user auth still
# applies on top of this — the reverse proxy stamps every forwarded request
# so the backend's `--local` auto-login shortcut never fires for a network
# caller (see aionui-auth/src/middleware.rs's WEBUI_PROXY_HEADER handling).
# This flag means "bind the socket where Docker can reach it", not "skip
# authentication".
ENV AIONUI_ALLOW_REMOTE=1 \
    AIONUI_PORT=25808 \
    AIONUI_DATA_DIR=/data \
    AIONUI_LOG_JSON=1 \
    NODE_ENV=production

# SQLite database + logs + workspace files. Mount a named volume or bind
# mount here — this is a single-instance deployment (see
# docs/guides/server-deployment.zh-CN.md § Known limitations), not a
# multi-replica one, so there is exactly one writer for this directory.
VOLUME ["/data"]

EXPOSE 25808

# /health is aioncore's own endpoint and is intentionally NOT proxied by the
# static server (only /api/*, /login, /logout are —
# packages/web-host/src/static-server.ts:425). /api/auth/status is the
# closest equivalent reachable through the public port, and it is
# deliberately public (the login page needs to ask "does this instance still
# need first-run setup?" before any session exists — aionui-auth/src/
# routes.rs). A 200 here means the static server, the reverse proxy,
# aioncore, and the SQLite connection are all alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${AIONUI_PORT}/api/auth/status" || exit 1

ENTRYPOINT ["./aionui-web", "start"]
