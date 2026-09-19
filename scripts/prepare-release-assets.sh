#!/usr/bin/env bash
# prepare-release-assets.sh
#
# Normalize electron-updater metadata from multi-arch build artifacts
# into a deterministic release-assets/ directory.
#
# Usage:
#   ./scripts/prepare-release-assets.sh [ARTIFACTS_DIR] [OUTPUT_DIR]
#
# Defaults:
#   ARTIFACTS_DIR = build-artifacts
#   OUTPUT_DIR    = release-assets

set -euo pipefail

ARTIFACTS_DIR="${1:-build-artifacts}"
OUTPUT_DIR="${2:-release-assets}"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# 1) Copy all distributables (unique file names)
# ---------------------------------------------------------------------------
echo "==> Copying distributables from $ARTIFACTS_DIR ..."
DISTRIBUTABLES=()
while IFS= read -r file; do
  DISTRIBUTABLES+=("$file")
done < <(find "$ARTIFACTS_DIR" -type f \( \
  -name "*.exe" -o \
  -name "*.msi" -o \
  -name "*.dmg" -o \
  -name "*.deb" -o \
  -name "*.zip" -o \
  -name "*.blockmap" \
\) | sort)

DUPLICATE_BASENAMES=$(for file in "${DISTRIBUTABLES[@]}"; do basename "$file"; done | sort | uniq -d || true)
if [ -n "$DUPLICATE_BASENAMES" ]; then
  echo "::error::Found duplicate distributable basenames that would be overwritten in flat output:"
  echo "$DUPLICATE_BASENAMES"
  exit 1
fi

for file in "${DISTRIBUTABLES[@]}"; do
  cp -f "$file" "$OUTPUT_DIR/"
done

# ---------------------------------------------------------------------------
# 1b) Copy web-cli tarballs (+ sha256 checksums)
# ---------------------------------------------------------------------------
echo "==> Copying web-cli tarballs from $ARTIFACTS_DIR ..."
WEB_CLI_FILES=()
while IFS= read -r file; do
  WEB_CLI_FILES+=("$file")
done < <(find "$ARTIFACTS_DIR" -type f \( \
  -name "dream-web-*.tar.gz" -o \
  -name "dream-web-*.tar.gz.sha256" \
\) | sort)

WEB_CLI_DUPS=$(for file in "${WEB_CLI_FILES[@]}"; do basename "$file"; done | sort | uniq -d || true)
if [ -n "$WEB_CLI_DUPS" ]; then
  echo "::error::Duplicate web-cli artifact basenames:"
  echo "$WEB_CLI_DUPS"
  exit 1
fi

for file in "${WEB_CLI_FILES[@]}"; do
  cp -f "$file" "$OUTPUT_DIR/"
done

# ---------------------------------------------------------------------------
# 1c) Copy install-web.sh (version-substituted)
# ---------------------------------------------------------------------------
echo "==> Copying install-web.sh ..."
INSTALL_SCRIPT=$(find "$ARTIFACTS_DIR" -type f -name 'install-web.sh' | head -n 1 || true)
if [ -n "$INSTALL_SCRIPT" ]; then
  cp -f "$INSTALL_SCRIPT" "$OUTPUT_DIR/install-web.sh"
  chmod +x "$OUTPUT_DIR/install-web.sh"
fi

# ---------------------------------------------------------------------------
# 2) Collect updater metadata from each platform artifact directory
# ---------------------------------------------------------------------------
echo "==> Collecting updater metadata ..."

WIN_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-x64/*" -name "latest.yml" | sort | head -n 1 || true)
WIN_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/windows-build-arm64/*" -name "latest.yml" | sort | head -n 1 || true)
MAC_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-x64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
MAC_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/macos-build-arm64/*" -name "latest-mac.yml" | sort | head -n 1 || true)
LINUX_X64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build-x64/*" -name "latest-linux.yml" | sort | head -n 1 || true)
LINUX_ARM64_LATEST=$(find "$ARTIFACTS_DIR" -type f -path "*/linux-build-arm64/*" -name "latest-linux-arm64.yml" | sort | head -n 1 || true)

# ---------------------------------------------------------------------------
# 3) Publish deterministic canonical metadata for electron-updater
#    (avoid nondeterministic overwrite when multiple jobs produce same names)
# ---------------------------------------------------------------------------
echo "==> Writing canonical updater metadata ..."

[ -n "$WIN_X64_LATEST" ]    && cp -f "$WIN_X64_LATEST"    "$OUTPUT_DIR/latest.yml"
[ -n "$MAC_X64_LATEST" ]    && cp -f "$MAC_X64_LATEST"    "$OUTPUT_DIR/latest-mac.yml"
[ -n "$LINUX_X64_LATEST" ]  && cp -f "$LINUX_X64_LATEST"  "$OUTPUT_DIR/latest-linux.yml"
[ -n "$LINUX_ARM64_LATEST" ] && cp -f "$LINUX_ARM64_LATEST" "$OUTPUT_DIR/latest-linux-arm64.yml"

# ---------------------------------------------------------------------------
# 4) Architecture-specific metadata required by electron-updater
# ---------------------------------------------------------------------------
echo "==> Writing architecture-specific updater metadata ..."

[ -n "$WIN_ARM64_LATEST" ]  && cp -f "$WIN_ARM64_LATEST"  "$OUTPUT_DIR/latest-win-arm64.yml"

# electron-updater on macOS constructs the yml filename as "${channel}-mac.yml".
# For arm64, channel is "latest-arm64", so it looks for "latest-arm64-mac.yml".
[ -n "$MAC_ARM64_LATEST" ]  && cp -f "$MAC_ARM64_LATEST"  "$OUTPUT_DIR/latest-arm64-mac.yml"

# ---------------------------------------------------------------------------
# 5) Validation — scoped to what this run actually built.
#
# Since 2026-09-07 releases are incremental (playbook §5.1): a run may carry
# one platform or all five. Demanding all four updater manifests unconditionally
# made this script fail on exactly the flows it exists to serve, so every check
# below is derived from what the artifacts directory contains: a platform with
# updater metadata must also have its distributables, and vice versa — either
# half alone ships an updater-less package silently. STRICT=1 restores the
# full-matrix demands (a complete build-and-release.yml matrix run).
# ---------------------------------------------------------------------------
echo "==> Validating metadata for what was built ..."

VERSION="${MOCK_VERSION:-$(node -p "require('./package.json').version")}"
MISSING=0

find_dist() { find "$OUTPUT_DIR" -maxdepth 1 -type f -name "$1" | head -n 1; }

# windows-x64: exe + latest.yml
if [ -n "$WIN_X64_LATEST" ]; then
  if [ ! -f "$OUTPUT_DIR/latest.yml" ]; then
    echo "::error::windows-x64 metadata found but latest.yml missing in output"
    MISSING=1
  fi
  if [ -z "$(find_dist "*-${VERSION}-win-x64.exe")" ]; then
    echo "::error::windows-x64 metadata found but no *-${VERSION}-win-x64.exe"
    MISSING=1
  fi
elif [ -n "$(find_dist "*-${VERSION}-win-x64.exe")" ]; then
  echo "::error::windows-x64 installer present without latest.yml — its auto-update would silently die"
  MISSING=1
fi

# windows-arm64 (dropped from the release matrix, kept for ad-hoc runs): exe + latest-win-arm64.yml
if [ -n "$WIN_ARM64_LATEST" ]; then
  if [ ! -f "$OUTPUT_DIR/latest-win-arm64.yml" ]; then
    echo "::error::windows-arm64 metadata found but latest-win-arm64.yml missing in output"
    MISSING=1
  fi
  if [ -z "$(find_dist "*-${VERSION}-win-arm64.exe")" ]; then
    echo "::error::windows-arm64 metadata found but no *-${VERSION}-win-arm64.exe"
    MISSING=1
  fi
fi

# macOS: per arch, dmg+zip and the arch's manifest must travel together
for arch in x64 arm64; do
  META_SRC="MAC_${arch^^}_LATEST"   # MAC_X64_LATEST / MAC_ARM64_LATEST
  META_NAME="latest-mac.yml"
  if [ "$arch" = "arm64" ]; then META_NAME="latest-arm64-mac.yml"; fi

  if [ -n "${!META_SRC:-}" ]; then
    if [ ! -f "$OUTPUT_DIR/$META_NAME" ]; then
      echo "::error::mac-$arch metadata found but $META_NAME missing in output"
      MISSING=1
    fi
    for ext in dmg zip; do
      if [ -z "$(find_dist "*-${VERSION}-mac-${arch}.${ext}")" ]; then
        echo "::error::mac-$arch metadata found but no *-${VERSION}-mac-${arch}.${ext}"
        MISSING=1
      fi
    done
  elif [ -n "$(find_dist "*-${VERSION}-mac-${arch}.zip")" ] || [ -n "$(find_dist "*-${VERSION}-mac-${arch}.dmg")" ]; then
    echo "::error::mac-$arch installer present without ${META_NAME} — mac-$arch auto-update would silently die"
    MISSING=1
  fi
done

# linux: per arch, installers and latest-linux*.yml must travel together
for arch in x64 arm64; do
  META_SRC="LINUX_${arch^^}_LATEST"
  META_NAME="latest-linux.yml"
  if [ "$arch" = "arm64" ]; then META_NAME="latest-linux-arm64.yml"; fi

  if [ -n "${!META_SRC:-}" ]; then
    if [ ! -f "$OUTPUT_DIR/$META_NAME" ]; then
      echo "::error::linux-$arch metadata found but $META_NAME missing in output"
      MISSING=1
    fi
  elif [ -n "$(find_dist "*-${VERSION}-linux-*.deb")" ]; then
    echo "::error::linux installer present without ${META_NAME} — linux auto-update would silently die"
    MISSING=1
  fi
done

# --- STRICT: the full-matrix contract, for build-and-release.yml after a complete matrix ---
if [ "${STRICT:-0}" = "1" ]; then
  for required in latest.yml latest-mac.yml latest-linux.yml latest-linux-arm64.yml; do
    if [ ! -f "$OUTPUT_DIR/$required" ]; then
      echo "::error::STRICT: Missing required updater metadata: $required"
      MISSING=1
    fi
  done
  for arch in x64 arm64; do
    for ext in dmg zip; do
      if [ -z "$(find_dist "*-${VERSION}-mac-${arch}.${ext}")" ]; then
        echo "::error::STRICT: Missing macOS $ext artifact for $arch matching *-${VERSION}-mac-${arch}.${ext}"
        MISSING=1
      fi
    done
  done
fi

# --- web-cli: all-or-nothing (pack-web-cli always emits the full set) ---
WEB_TARBALL_COUNT=$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name "dream-web-*.tar.gz" | wc -l)
if [ "$WEB_TARBALL_COUNT" -gt 0 ]; then
  for plat in darwin-arm64 darwin-x86_64 linux-arm64 linux-x86_64 win-x86_64; do
    tarball="dream-web-${VERSION}-${plat}.tar.gz"
    if [ ! -f "$OUTPUT_DIR/$tarball" ]; then
      echo "::error::Missing web-cli tarball: $tarball"
      MISSING=1
    fi
    if [ ! -f "$OUTPUT_DIR/${tarball}.sha256" ]; then
      echo "::error::Missing web-cli checksum: ${tarball}.sha256"
      MISSING=1
    fi
  done
  if [ ! -f "$OUTPUT_DIR/install-web.sh" ]; then
    echo "::error::web-cli tarballs present but install-web.sh missing"
    MISSING=1
  fi
fi

if [ "$MISSING" -ne 0 ]; then
  exit 1
fi

echo ""
echo "==> Prepared release assets:"
ls -lh "$OUTPUT_DIR"
echo ""
echo "==> Done."
