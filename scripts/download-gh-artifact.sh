#!/usr/bin/env bash
#
# Resilient, verified download of a GitHub Actions artifact — for when
# `gh run download` isn't enough.
#
# 2026-09-07: `gh run download` sat for 51 minutes downloading a 1.4GB
# macOS artifact over the company's internal-network-to-GitHub link, printing
# *nothing* the whole time (no progress, no error, no retry message). The
# connection itself wasn't blocked — the stall was specifically in the
# sustained data transfer from GitHub's artifact storage (an Azure Blob
# redirect target), which can go quiet mid-stream with no indication from the
# `gh` CLI. A direct `curl` with `--speed-limit`/`--speed-time` (abort when
# throughput stays below the threshold) fixed it.
#
# 2026-10-31 corrections (playbook "CI 产物下载三坑"):
#   - NEVER resume (`-C -`). Resuming across GitHub's 302 to the CDN is
#     unreliable: a 416 error body can be appended as if it were data, leaving
#     a file 32KB/64KB too big with a shifted prefix. Every attempt here starts
#     from an empty file, one stream.
#   - Nothing else may write the same file (a killed loop that left a curl
#     behind produced an endlessly growing zip). The zip name embeds this
#     process id.
#   - The `.../zip` endpoint wants `Accept: application/vnd.github+json` and
#     answers 303 to the blob store. (`application/octet-stream`, which an
#     older playbook note recommended, gets 415 as of 2026-11-02 — a 186-byte
#     JSON error that the size check below catches.)
#   - The target of verification is GitHub's own artifact metadata:
#     `size_in_bytes` and `digest: sha256:<hex>`. A download only counts once
#     both match byte for byte.
#
# Usage:
#   scripts/download-gh-artifact.sh <owner/repo> <run_id> <artifact-name> <out-dir>
#
# Requires: gh (authenticated, or GH_TOKEN set), curl, python (or python3).
# Env: MAX_ATTEMPTS (default 8), SPEED_LIMIT_BYTES (default 1024), SPEED_TIME_SECONDS (default 60)

set -euo pipefail

if [ $# -ne 4 ]; then
  echo "Usage: $0 <owner/repo> <run_id> <artifact-name> <out-dir>" >&2
  exit 2
fi

REPO="$1"
RUN_ID="$2"
ARTIFACT_NAME="$3"
OUT_DIR="$4"

MAX_ATTEMPTS="${MAX_ATTEMPTS:-8}"
# "Effectively stopped", not "just slow": a genuinely slow but alive connection
# stays well above 1 KiB/s even on the worst office-to-GitHub path seen.
SPEED_LIMIT_BYTES="${SPEED_LIMIT_BYTES:-1024}"
SPEED_TIME_SECONDS="${SPEED_TIME_SECONDS:-60}"

# Pick an interpreter that actually runs: on Windows `python3` is often the
# Microsoft Store placeholder, which exits silently without doing anything.
PY=""
for candidate in python python3; do
  if command -v "$candidate" >/dev/null 2>&1 && [ "$("$candidate" -c 'print(1)' 2>/dev/null)" = "1" ]; then
    PY="$candidate"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "download-gh-artifact: python is required (zip extraction and sha256)" >&2
  exit 1
fi

META=$(gh api "repos/${REPO}/actions/runs/${RUN_ID}/artifacts" \
  --jq ".artifacts[] | select(.name == \"${ARTIFACT_NAME}\")" | head -n1)

if [ -z "$META" ]; then
  echo "download-gh-artifact: no artifact named '${ARTIFACT_NAME}' on run ${RUN_ID} (repo ${REPO})" >&2
  exit 1
fi

read -r ARTIFACT_ID EXPECTED_SIZE EXPECTED_DIGEST EXPIRED < <(
  printf '%s' "$META" | "$PY" -c "import sys,json;d=json.load(sys.stdin);print(d['id'],d['size_in_bytes'],(d.get('digest') or '').replace('sha256:',''),d.get('expired'))"
)

if [ "$EXPIRED" = "True" ] || [ "$EXPIRED" = "true" ]; then
  echo "download-gh-artifact: artifact '${ARTIFACT_NAME}' on run ${RUN_ID} has expired" >&2
  exit 1
fi

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-$(gh auth token)}}"
mkdir -p "$OUT_DIR"
ZIP_PATH="${OUT_DIR}/${ARTIFACT_NAME}.$$.download.zip"
trap 'rm -f "$ZIP_PATH"' EXIT

echo "download-gh-artifact: artifact id=${ARTIFACT_ID} size=${EXPECTED_SIZE} -> ${ZIP_PATH}"

ok=0
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  rm -f "$ZIP_PATH"
  echo "download-gh-artifact: attempt ${attempt}/${MAX_ATTEMPTS}"
  if curl -sSL \
    --connect-timeout 15 \
    --speed-limit "$SPEED_LIMIT_BYTES" --speed-time "$SPEED_TIME_SECONDS" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -o "$ZIP_PATH" \
    "https://api.github.com/repos/${REPO}/actions/artifacts/${ARTIFACT_ID}/zip"; then
    ACTUAL_SIZE=$(wc -c < "$ZIP_PATH" | tr -d ' ')
    if [ "$ACTUAL_SIZE" != "$EXPECTED_SIZE" ]; then
      echo "download-gh-artifact: size ${ACTUAL_SIZE} != expected ${EXPECTED_SIZE}, retrying from scratch"
      sleep 3
      continue
    fi
    if [ -n "$EXPECTED_DIGEST" ]; then
      ACTUAL_DIGEST=$("$PY" -c "import hashlib,sys;h=hashlib.sha256();f=open(sys.argv[1],'rb');[h.update(b) for b in iter(lambda:f.read(1<<20),b'')];print(h.hexdigest())" "$ZIP_PATH")
      if [ "$ACTUAL_DIGEST" != "$EXPECTED_DIGEST" ]; then
        echo "download-gh-artifact: sha256 ${ACTUAL_DIGEST} != expected ${EXPECTED_DIGEST}, retrying from scratch"
        sleep 3
        continue
      fi
      echo "download-gh-artifact: size and sha256 match GitHub's artifact metadata"
    else
      echo "download-gh-artifact: warning — GitHub returned no digest for this artifact; size matches only"
    fi
    ok=1
    break
  fi
  echo "download-gh-artifact: attempt ${attempt} failed (stalled or connection error)"
  sleep 3
done

if [ "$ok" != 1 ]; then
  echo "download-gh-artifact: giving up after ${MAX_ATTEMPTS} attempts (retry at another time of day if the link is throttled)" >&2
  exit 1
fi

echo "download-gh-artifact: verified, extracting into ${OUT_DIR}"
"$PY" -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$ZIP_PATH" "$OUT_DIR"
rm -f "$ZIP_PATH"

echo "download-gh-artifact: done"
ls -la "$OUT_DIR"
