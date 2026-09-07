#!/usr/bin/env bash
#
# Resilient download of a GitHub Actions artifact — for when `gh run
# download` isn't enough.
#
# 2026-09-07: `gh run download` sat for 51 minutes downloading a 1.4GB
# macOS artifact over the company's internal-network-to-GitHub link,
# printing *nothing* the whole time (no progress, no error, no retry
# message) before it was killed by hand. The connection itself wasn't
# blocked -- `github.com` / `api.github.com` both answered instantly the
# whole time -- the stall was specifically in the sustained data transfer
# from GitHub's artifact storage (an Azure Blob redirect target), which can
# apparently go quiet mid-stream on this network path with no indication
# from the `gh` CLI that anything is wrong.
#
# Switching to a direct `curl` against the same API endpoint, with
# `--speed-limit`/`--speed-time` (abort if throughput drops below the
# threshold for that long) and `-C -` (resume from the byte offset already
# on disk) fixed it: the first stalled connection got dropped and retried
# automatically, the retry resumed instead of restarting the whole 1.4GB,
# and the whole download finished in under 9 minutes once a healthy
# connection was found. That combination is worth having as a script
# rather than retyped by hand next time.
#
# Usage:
#   scripts/download-gh-artifact.sh <owner/repo> <run_id> <artifact-name> <out-dir>
#
# Requires: gh (authenticated), curl, unzip.

set -euo pipefail

if [ $# -ne 4 ]; then
  echo "Usage: $0 <owner/repo> <run_id> <artifact-name> <out-dir>" >&2
  exit 2
fi

REPO="$1"
RUN_ID="$2"
ARTIFACT_NAME="$3"
OUT_DIR="$4"

# Speed-stall threshold: abort and retry (not just wait) once throughput
# drops below this for this long. 1 KiB/s for 30s is "effectively stopped",
# not "just slow" -- a genuinely slow-but-alive connection stays well above
# this even at the ~1-2.5 MiB/s this network path has shown historically.
SPEED_LIMIT_BYTES=1024
SPEED_TIME_SECONDS=30
MAX_RETRIES=20

ARTIFACT_ID=$(gh api "repos/${REPO}/actions/runs/${RUN_ID}/artifacts" \
  --jq ".artifacts[] | select(.name == \"${ARTIFACT_NAME}\") | .id" | head -n1)

if [ -z "$ARTIFACT_ID" ]; then
  echo "download-gh-artifact: no artifact named '${ARTIFACT_NAME}' on run ${RUN_ID} (repo ${REPO})" >&2
  exit 1
fi

TOKEN=$(gh auth token)
ZIP_PATH="${OUT_DIR}/${ARTIFACT_NAME}.download.zip"

mkdir -p "$OUT_DIR"

echo "download-gh-artifact: artifact id=${ARTIFACT_ID} -> ${ZIP_PATH}"

curl -L -C - \
  --retry "$MAX_RETRIES" --retry-delay 3 --retry-all-errors \
  --connect-timeout 15 \
  --speed-limit "$SPEED_LIMIT_BYTES" --speed-time "$SPEED_TIME_SECONDS" \
  -H "Authorization: token ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -o "$ZIP_PATH" \
  "https://api.github.com/repos/${REPO}/actions/artifacts/${ARTIFACT_ID}/zip"

echo "download-gh-artifact: downloaded, extracting into ${OUT_DIR}"
unzip -o "$ZIP_PATH" -d "$OUT_DIR" >/dev/null
rm -f "$ZIP_PATH"

echo "download-gh-artifact: done"
ls -la "$OUT_DIR"
