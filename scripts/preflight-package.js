#!/usr/bin/env node
/**
 * Pre-flight for desktop packaging: refuse to build an installer that silently
 * lacks work which is already committed.
 *
 * An installer is assembled from parts that go stale independently, and the
 * build itself notices none of them:
 *
 *   1. the renderer/main bundles — compiled from THIS checkout
 *   2. dreamcore                 — downloaded from the dream-core GitHub release
 *                                  pinned by package.json "dreamcoreVersion",
 *                                  NOT built from dream-core main
 *   3. dream-engine              — compiled into dreamcore, pinned by
 *                                  dream-core's Cargo.lock
 *
 * Each check is a mistake that was actually made or nearly made (2026-10-08:
 * the pin sat on v0.1.79 while dream-core main had the backend half of a new
 * feature; the v0.1.80 release then came out without macOS binaries because
 * GitHub had no macOS runner). See docs/guides/desktop-release-runbook.zh-CN.md.
 *
 * Usage:
 *   node scripts/preflight-package.js [--platform win32|darwin|linux] [--arch x64,arm64]
 * Called by scripts/build-with-builder.js before any build work.
 * Env:
 *   DREAM_SKIP_PREFLIGHT=1  skip (say why in the release notes / commit)
 *   GH_TOKEN / GITHUB_TOKEN used for GitHub API calls when present (rate limit)
 */

const { execSync } = require('child_process');
const path = require('path');
const { resolveDreamcoreVersion } = require('./resolveDreamcoreVersion.js');

const CORE_REPO = 'gaogg521/dream-core';
const ENGINE_REPO = 'gaogg521/dream-engine';
const PROJECT_ROOT = path.resolve(__dirname, '..');

const TRIPLES = {
  darwin: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win32: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
  linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
};

/** Files whose change makes a dreamcore binary different. Tests and docs do not. */
const isBuildRelevant = (file) =>
  (file === 'Cargo.toml' || file === 'Cargo.lock' || file.startsWith('.cargo/') || file.startsWith('crates/')) &&
  !/\/tests\//.test(file) &&
  !file.endsWith('_test.rs') &&
  !file.endsWith('.md');

const parseArgs = (argv) => {
  const read = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    platform: read('--platform') || process.platform,
    archs: (read('--arch') || process.arch).split(',').filter(Boolean),
  };
};

const git = (args) => execSync(`git ${args}`, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();

async function github(pathname) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dream-ui-preflight',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${pathname} -> HTTP ${response.status}`);
  return response.json();
}

async function rawFile(repo, ref, file) {
  const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${file}`);
  if (!response.ok) throw new Error(`${repo}@${ref}:${file} -> HTTP ${response.status}`);
  return response.text();
}

async function main() {
  const { platform, archs } = parseArgs(process.argv.slice(2));
  const fails = [];
  const warns = [];
  const fail = (message) => fails.push(message);

  console.log('==> pre-flight: is all committed work actually in this installer?');

  // --- 1. this checkout: what gets compiled is what is on GitHub ------------
  // CI checks out a pushed ref, so only local builds can be dirty or ahead.
  if (!process.env.CI) {
    try {
      const dirty = git('status --porcelain --untracked-files=no');
      if (dirty) {
        fail(
          `dream-ui has uncommitted changes — commit and push them, or the installer contains code nobody can find:\n${dirty
            .split('\n')
            .slice(0, 5)
            .map((line) => `        ${line}`)
            .join('\n')}`
        );
      }
      const ahead = git('rev-list --count @{u}..HEAD');
      if (ahead !== '0') fail(`dream-ui has ${ahead} commit(s) not pushed — push before packaging`);
    } catch (error) {
      warns.push(`could not inspect the dream-ui checkout (${error.message.split('\n')[0]})`);
    }
  }

  // --- 2. dreamcore: the pinned release contains dream-core main ------------
  const tag = resolveDreamcoreVersion(PROJECT_ROOT);
  if (process.env.DREAM_BACKEND_LOCAL_PATH || process.env.DREAM_BACKEND_RUN_ID) {
    warns.push(
      'dreamcore comes from DREAM_BACKEND_LOCAL_PATH / DREAM_BACKEND_RUN_ID, not the pinned release — this installer cannot be reproduced; do not publish it'
    );
  } else if (tag === 'latest') {
    fail('no "dreamcoreVersion" pin in package.json — packaging would take whatever release is newest');
  } else {
    try {
      const compare = await github(`/repos/${CORE_REPO}/compare/${tag}...main`);
      const missing = (compare.files || []).map((file) => file.filename).filter(isBuildRelevant);
      if (missing.length > 0) {
        const subjects = (compare.commits || [])
          .map((commit) => `        ${commit.sha.slice(0, 7)} ${commit.commit.message.split('\n')[0]}`)
          .slice(-10);
        fail(
          `pinned dreamcore ${tag} is ${compare.ahead_by} commit(s) behind dream-core main, ${missing.length} build-relevant file(s) changed — the installer would ship the old backend:\n${subjects.join('\n')}\n      fix: release dream-core (merge the release-please PR, then run the Release workflow for the new tag — tags do NOT trigger it), then bump "dreamcoreVersion"`
        );
      } else if (compare.ahead_by > 0) {
        warns.push(`dream-core main is ${compare.ahead_by} commit(s) past ${tag}, none of them build-relevant`);
      }
    } catch (error) {
      fail(
        `could not compare ${tag} with dream-core main (${error.message}) — cannot tell whether the backend is current`
      );
    }

    // --- 3. the release has the binaries this build will download -----------
    try {
      const release = await github(`/repos/${CORE_REPO}/releases/tags/${tag}`);
      const names = new Set((release.assets || []).map((asset) => asset.name));
      for (const arch of archs) {
        const triple = TRIPLES[platform]?.[arch];
        if (!triple) continue;
        const asset = `dreamcore-${tag}-${triple}${platform === 'win32' ? '.zip' : '.tar.gz'}`;
        if (!names.has(asset)) {
          fail(
            `release ${tag} has no ${asset} — its Release workflow did not finish for this platform (re-run the failed jobs: gh run rerun <id> --failed)`
          );
        }
      }
    } catch (error) {
      fail(`could not read release ${tag} (${error.message})`);
    }
  }

  // --- 4. dream-engine work that no dreamcore contains yet -----------------
  try {
    const lock = await rawFile(CORE_REPO, 'main', 'Cargo.lock');
    const pin = (lock.match(/dream-engine\.git\?branch=main#([0-9a-f]{40})/) || [])[1];
    if (!pin) {
      warns.push('no dream-engine pin found in dream-core main Cargo.lock');
    } else {
      const compare = await github(`/repos/${ENGINE_REPO}/compare/${pin}...main`);
      if (compare.status === 'diverged' || compare.status === 'behind') {
        fail(
          `dream-core pins dream-engine ${pin.slice(0, 9)}, which is not on dream-engine main (history rewritten) — repin: cd dream-core && cargo update -p dream-engine-agent`
        );
      } else {
        const code = (compare.files || []).filter((file) => isBuildRelevant(file.filename)).length;
        if (code > 0) {
          warns.push(
            `dream-engine main has ${code} changed source file(s) past the pin ${pin.slice(0, 9)} — not in any dreamcore yet; if intended, ignore; else: cargo update -p dream-engine-agent in dream-core, then release`
          );
        }
      }
    }
  } catch (error) {
    warns.push(`could not check the dream-engine pin (${error.message})`);
  }

  console.log(`    platform ${platform}, arch ${archs.join(',')}, dreamcore ${tag}`);
  warns.forEach((warning) => console.log(`    warn: ${warning}`));
  if (fails.length > 0) {
    fails.forEach((failure) => console.log(`    FAIL: ${failure}`));
    console.log('\npre-flight failed — the installer would silently miss committed work.');
    console.log(
      'Fix the above (docs/guides/desktop-release-runbook.zh-CN.md), or set DREAM_SKIP_PREFLIGHT=1 if you know why.'
    );
    process.exit(1);
  }
  console.log('    pre-flight passed');
}

if (process.env.DREAM_SKIP_PREFLIGHT === '1') {
  console.log('⚠️  DREAM_SKIP_PREFLIGHT=1: packaging pre-flight skipped');
} else if (require.main === module) {
  main().catch((error) => {
    console.error(`pre-flight crashed: ${error.stack || error}`);
    process.exit(1);
  });
}

module.exports = { isBuildRelevant };
