/**
 * Prepare the pinned frpc binary used by "remote access" (phone -> own desktop).
 *
 * Downloads the official frp release for the target platform, verifies it
 * against the pinned SHA-256, and extracts only `frpc` into
 * resources/frpc/<platform>-<arch>/ . Packaged apps read it from
 * <resources>/frpc/<platform>-<arch>/ (see electron-builder.yml extraResources).
 *
 * Usage: node scripts/prepareFrpc.mjs [--platform win32|darwin|linux] [--arch x64|arm64] [--verify]
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.72.0';
// Official checksums from https://github.com/fatedier/frp/releases/tag/v0.72.0 (frp_sha256_checksums.txt).
const ASSETS = {
  'win32-x64': {
    file: `frp_${VERSION}_windows_amd64.zip`,
    sha256: '5197c1b69564089cdc229fc1260a0e25db1e722b1b7db45fe1542c3c43edf9ae',
  },
  'win32-arm64': {
    file: `frp_${VERSION}_windows_arm64.zip`,
    sha256: 'e4b83b66c4045971dd9a47cdef16dd02af471aaa6667dd303e63b1a669162927',
  },
  'darwin-x64': {
    file: `frp_${VERSION}_darwin_amd64.tar.gz`,
    sha256: '60439dc6bf794c4182a1a4cac147d642f839d55201607208979eb23aecd09be9',
  },
  'darwin-arm64': {
    file: `frp_${VERSION}_darwin_arm64.tar.gz`,
    sha256: '6e8576c5b6b9914a86850f6ff4fb81c5a09e706f91f70f64d5f398558bdc9db8',
  },
  'linux-x64': {
    file: `frp_${VERSION}_linux_amd64.tar.gz`,
    sha256: 'daf719b32ca2778770bb92955e231a07414d754378b9af328aa2642862479804',
  },
  'linux-arm64': {
    file: `frp_${VERSION}_linux_arm64.tar.gz`,
    sha256: '02180b857480302fd934e9ddbd50fe2f73229f99062f88756abc6de9df5e95cf',
  },
};

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const platform = arg('platform') ?? process.platform;
const arch = arg('arch') ?? process.arch;
const verifyOnly = process.argv.includes('--verify');

const key = `${platform}-${arch}`;
const asset = ASSETS[key];
if (!asset) throw new Error(`frpc: unsupported platform ${key}`);

const exe = platform === 'win32' ? 'frpc.exe' : 'frpc';
const targetDir = join(root, 'resources', 'frpc', key);
const target = join(targetDir, exe);
const stamp = join(targetDir, 'VERSION');

if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${VERSION} ${asset.sha256}`) {
  console.log(`frpc ${VERSION} (${key}) already prepared`);
  process.exit(0);
}
if (verifyOnly) throw new Error(`frpc ${VERSION} (${key}) is missing; run node scripts/prepareFrpc.mjs`);

const work = mkdtempSync(join(tmpdir(), 'frpc-'));
try {
  const archive = join(work, asset.file);
  const url = `https://github.com/fatedier/frp/releases/download/v${VERSION}/${asset.file}`;
  console.log(`frpc: downloading ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`frpc download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256) throw new Error(`frpc checksum mismatch for ${asset.file}: ${actual}`);
  writeFileSync(archive, bytes);

  const inner = `frp_${VERSION}_${asset.file
    .split('_')
    .slice(2)
    .join('_')
    .replace(/\.(zip|tar\.gz)$/, '')}/${exe}`;
  let x;
  if (asset.file.endsWith('.zip')) {
    // GNU tar (Git Bash) cannot read zip and mistakes `C:` for a remote host,
    // so use PowerShell, which every Windows build machine has.
    x = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${work}' -Force`,
      ],
      { stdio: 'inherit' }
    );
  } else {
    // Relative paths + cwd: an absolute `C:\...` archive path breaks GNU tar.
    x = spawnSync('tar', ['-xzf', asset.file, inner], { cwd: work, stdio: 'inherit' });
  }
  if (x.status !== 0) throw new Error(`frpc: extract failed (exit ${x.status})`);

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(join(work, inner), target);
  if (platform !== 'win32') chmodSync(target, 0o755);
  writeFileSync(stamp, `${VERSION} ${asset.sha256}\n`);
  console.log(`frpc prepared: ${target}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
