#!/usr/bin/env bash
#
# Upload one release asset to COS, and — when it's an auto-update manifest —
# automatically mirror it to the root polling path too. One call, can't
# forget the second half.
#
# 2026-09-07: five separate `latest*.yml` root copies (win, mac-x64,
# mac-arm64, linux-x64, linux-arm64) got mixed results across a single
# release night — some remembered, most didn't, because "upload the
# versioned copy" and "sync the root polling file" were two manual steps a
# human had to remember to both do, for every platform, every release. Four
# of five silently stayed on the *previous* version's root manifest while
# the versioned copy and the website both correctly showed the new one —
# so every existing installation on those four platforms kept polling a
# manifest promising no update was available, with no visible symptom
# until a user reported "checked for updates, says I'm current" on a
# build that was two behind.
#
# electron-updater's root-polling contract: `releases/latest.yml` (win),
# `releases/latest-mac.yml` (macOS Intel / default), `releases/latest-arm64-mac.yml`
# (macOS Apple Silicon), `releases/latest-linux.yml` (linux x64),
# `releases/latest-linux-arm64.yml` (linux arm64) are the files every
# installed client actually polls — the versioned copy under
# `releases/<version>/` is only ever fetched as a byproduct of resolving
# the URL *inside* the root file the client already has.
#
# Usage:
#   scripts/publish-cos-release-asset.sh <local-file> <version>
#
# Requires COS credentials already exported in the environment (see
# scripts/fetch-cos-credentials.js) and the bucket's S3-compat settings
# already configured (addressing_style virtual). Installers (.exe/.dmg/.deb)
# upload to the versioned path only — only `latest*.yml` files get the root
# mirror, detected from the filename, not a flag you can forget to pass.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <local-file> <version>" >&2
  exit 2
fi

LOCAL_FILE="$1"
VERSION="$2"

if [ ! -f "$LOCAL_FILE" ]; then
  echo "publish-cos-release-asset: no such file: $LOCAL_FILE" >&2
  exit 1
fi

BUCKET="s3://1onework-1251001122"
ENDPOINT="https://cos.ap-shanghai.myqcloud.com"
FILENAME=$(basename "$LOCAL_FILE")

aws s3 cp "$LOCAL_FILE" "${BUCKET}/releases/${VERSION}/${FILENAME}" \
  --endpoint-url "$ENDPOINT" --acl public-read
echo "publish-cos-release-asset: releases/${VERSION}/${FILENAME} uploaded"

case "$FILENAME" in
  latest*.yml)
    aws s3 cp "${BUCKET}/releases/${VERSION}/${FILENAME}" "${BUCKET}/releases/${FILENAME}" \
      --endpoint-url "$ENDPOINT" --acl public-read
    echo "publish-cos-release-asset: releases/${FILENAME} (root polling path) mirrored"
    ;;
  *)
    echo "publish-cos-release-asset: not an update manifest, no root mirror needed"
    ;;
esac
