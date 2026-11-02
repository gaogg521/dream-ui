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
# 2026-11-02: two buckets, one call uploads to both.
#   new    onework-1521070673   — public downloads (the website links here for
#                                 versions after 3.0.16, see the site's
#                                 site.config.js). Static key in
#                                 ONEWORK_COS_ACCESS_KEY_ID / ONEWORK_COS_SECRET_ACCESS_KEY.
#   legacy 1onework-1251001122  — the update channel already-installed clients
#                                 poll (the address is baked into the shipped
#                                 app: electron-builder.yml / updateFeed.ts), so
#                                 every release must keep landing here until a
#                                 release that points at the new bucket has
#                                 rolled out. Credentials: the usual
#                                 AWS_* from scripts/fetch-cos-credentials.js.
# The two credential sets cannot cross over (each only authorises its own
# bucket), so they are kept apart below and never mixed in one aws call.
#
# Usage:
#   scripts/publish-cos-release-asset.sh <local-file> <version>
#
# Env:
#   COS_PUBLISH_TARGETS   "new,legacy" (default) | "new" | "legacy"
#   ONEWORK_COS_ACCESS_KEY_ID / ONEWORK_COS_SECRET_ACCESS_KEY   for `new`
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (/ AWS_SESSION_TOKEN)   for `legacy`
#
# Installers (.exe/.dmg/.deb) upload to the versioned path only — only
# `latest*.yml` files get the root mirror, detected from the filename, not a
# flag you can forget to pass. The S3-compat setting (addressing_style virtual)
# is applied here so a fresh machine does not need it pre-configured.

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

ENDPOINT="https://cos.ap-shanghai.myqcloud.com"
NEW_BUCKET="onework-1521070673"
LEGACY_BUCKET="1onework-1251001122"
TARGETS="${COS_PUBLISH_TARGETS:-new,legacy}"
FILENAME=$(basename "$LOCAL_FILE")

aws configure set default.s3.addressing_style virtual

# Run aws against one bucket with exactly that bucket's credentials.
aws_new() {
  env -u AWS_SESSION_TOKEN \
    AWS_ACCESS_KEY_ID="$ONEWORK_COS_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$ONEWORK_COS_SECRET_ACCESS_KEY" \
    aws "$@" --endpoint-url "$ENDPOINT"
}
aws_legacy() {
  aws "$@" --endpoint-url "$ENDPOINT"
}

# publish <label> <aws-fn> <bucket>
publish() {
  local label="$1" run="$2" bucket="s3://$3"
  "$run" s3 cp "$LOCAL_FILE" "${bucket}/releases/${VERSION}/${FILENAME}" --acl public-read
  echo "publish-cos-release-asset: [${label}] releases/${VERSION}/${FILENAME} uploaded"
  case "$FILENAME" in
    latest*.yml)
      "$run" s3 cp "${bucket}/releases/${VERSION}/${FILENAME}" "${bucket}/releases/${FILENAME}" --acl public-read
      echo "publish-cos-release-asset: [${label}] releases/${FILENAME} (root polling path) mirrored"
      ;;
    *)
      echo "publish-cos-release-asset: [${label}] not an update manifest, no root mirror needed"
      ;;
  esac
}

# Fail before uploading anything if a requested target has no credentials, so a
# release is never half-published to one bucket without the operator noticing.
case ",${TARGETS}," in
  *,new,*)
    if [ -z "${ONEWORK_COS_ACCESS_KEY_ID:-}" ] || [ -z "${ONEWORK_COS_SECRET_ACCESS_KEY:-}" ]; then
      echo "publish-cos-release-asset: target 'new' needs ONEWORK_COS_ACCESS_KEY_ID / ONEWORK_COS_SECRET_ACCESS_KEY" >&2
      exit 1
    fi
    ;;
esac
case ",${TARGETS}," in
  *,legacy,*)
    if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
      echo "publish-cos-release-asset: target 'legacy' needs AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (scripts/fetch-cos-credentials.js)" >&2
      exit 1
    fi
    ;;
esac
case ",${TARGETS}," in
  *,new,*|*,legacy,*) ;;
  *) echo "publish-cos-release-asset: COS_PUBLISH_TARGETS must contain new and/or legacy (got '${TARGETS}')" >&2; exit 2 ;;
esac

case ",${TARGETS}," in *,new,*) publish new aws_new "$NEW_BUCKET" ;; esac
case ",${TARGETS}," in *,legacy,*) publish legacy aws_legacy "$LEGACY_BUCKET" ;; esac
