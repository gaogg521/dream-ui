/**
 * Copyright 2026 One Work
 *
 * The `frpc` binary behind remote access is NOT part of the installer: several
 * antivirus engines flag every frp build as a hacking tool, and shipping it made
 * the installer itself get quarantined. It is downloaded once, after the user has
 * agreed to it, into the user-data directory.
 *
 * Trust comes from the pinned SHA-256 of the exact binary per platform — a download
 * that does not match is discarded, so the host only has to be reachable, not trusted.
 * No Electron imports: everything here is plain Node so it can be unit-tested.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FRPC_VERSION = '0.72.0';

/** SHA-256 of the raw binary (not the upstream archive) extracted from frp v0.72.0. */
export const FRPC_BINARY_SHA256: Record<string, string> = {
  'win32-x64': 'b8580b916ecb2e27ecc348bc67bc8b93b0e65266f85fd5d703e2f2f69862b089',
  'win32-arm64': '454e74f2d351272d14b7fe002f4771f21f702d178ce3b252bd6b17b93868c656',
  'darwin-x64': '64b7422a5a497191aa96b509eae3c6acedfd24ba163aebea25ddce444f2ea5f4',
  'darwin-arm64': '92f72de7473ca7918f9381e4e467495f4047413f706ee4756582a90706563980',
  'linux-x64': '522352244a4872beaa0ad6fa136c8cc8d2e993e72bcf49f9c8a1d9683770d80e',
  'linux-arm64': 'b92f35651f25c45a414542d72150474688b6320af03192febcb418e0b4cf2644',
};

/**
 * Where the binaries are hosted: the same two COS buckets the updater uses, new one
 * first (see updateFeed.ts). Layout: `<base>/components/frpc/<version>/<platform>-<arch>/<file>`.
 */
export const FRPC_DOWNLOAD_BASES: readonly string[] = [
  'https://onework-1521070673.cos.ap-shanghai.myqcloud.com/components/frpc',
  'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/components/frpc',
];

export type FrpcInstallErrorCode = 'download_failed' | 'blocked';

export class FrpcInstallError extends Error {
  constructor(
    readonly code: FrpcInstallErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'FrpcInstallError';
  }
}

export const frpcPlatformKey = (platform: string, arch: string): string => `${platform}-${arch}`;
export const frpcExeName = (platform: string): string => (platform === 'win32' ? 'frpc.exe' : 'frpc');

/** `<dataDir>/bin/<version>/<platform>-<arch>/frpc[.exe]` */
export function installedFrpcPath(dataDir: string, platform: string, arch: string): string {
  return path.join(dataDir, 'bin', FRPC_VERSION, frpcPlatformKey(platform, arch), frpcExeName(platform));
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** True when the file exists and is byte-for-byte the pinned binary. */
function matchesPinned(file: string, expected: string): boolean {
  try {
    return sha256Hex(fs.readFileSync(file)) === expected;
  } catch {
    return false;
  }
}

/**
 * The downloaded frpc, only if it is still intact. A missing file (deleted by an
 * antivirus) and a modified one are both "not installed", so the user is asked again
 * rather than a swapped-in executable being run.
 */
export function findInstalledFrpc(dataDir: string, platform: string, arch: string): string | null {
  const expected = FRPC_BINARY_SHA256[frpcPlatformKey(platform, arch)];
  if (!expected) return null;
  const file = installedFrpcPath(dataDir, platform, arch);
  return matchesPinned(file, expected) ? file : null;
}

export type DownloadFrpcOptions = {
  dataDir: string;
  platform: string;
  arch: string;
  fetch: typeof fetch;
  /** Overridable for tests. */
  bases?: readonly string[];
  /** Pinned hash override for tests. */
  expectedSha256?: string;
  /** How long to wait before re-checking that an antivirus did not remove the file. */
  settleMs?: number;
  timeoutMs?: number;
  log?: (message: string) => void;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Errors that mean "the OS or a security product refused to let us write/run the file". */
export const isBlockedFsError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'UNKNOWN';
};

/**
 * Download the pinned frpc for this platform, verify it, and put it in place.
 * Tries each host in order; a failed or mismatching download moves on to the next.
 * Throws {@link FrpcInstallError}: `download_failed` when no host delivered a valid
 * binary, `blocked` when the file was written but a security product removed or
 * locked it right away.
 */
export async function downloadFrpc(options: DownloadFrpcOptions): Promise<string> {
  const { dataDir, platform, arch, log } = options;
  const key = frpcPlatformKey(platform, arch);
  const expected = options.expectedSha256 ?? FRPC_BINARY_SHA256[key];
  if (!expected) throw new FrpcInstallError('download_failed', `unsupported platform ${key}`);

  const target = installedFrpcPath(dataDir, platform, arch);
  const bases = options.bases ?? FRPC_DOWNLOAD_BASES;
  const failures: string[] = [];
  let bytes: Buffer | null = null;

  for (const base of bases) {
    const url = `${base}/${FRPC_VERSION}/${key}/${frpcExeName(platform)}`;
    try {
      const res = await options.fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 180_000) });
      if (!res.ok) {
        failures.push(`${url}: HTTP ${res.status}`);
        continue;
      }
      const candidate = Buffer.from(await res.arrayBuffer());
      if (sha256Hex(candidate) !== expected) {
        failures.push(`${url}: checksum mismatch`);
        continue;
      }
      bytes = candidate;
      break;
    } catch (error) {
      failures.push(`${url}: ${String(error)}`);
    }
  }
  if (!bytes) {
    log?.(`frpc download failed: ${failures.join('; ')}`);
    throw new FrpcInstallError('download_failed', failures.join('; '));
  }

  const part = `${target}.part`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(part, bytes, { mode: 0o755 });
    fs.renameSync(part, target);
    if (platform !== 'win32') fs.chmodSync(target, 0o755);
  } catch (error) {
    fs.rmSync(part, { force: true });
    if (isBlockedFsError(error)) throw new FrpcInstallError('blocked', String(error));
    throw new FrpcInstallError('download_failed', String(error));
  }

  // Real-time scanners usually act within a second of the file closing.
  await sleep(options.settleMs ?? 1500);
  if (!matchesPinned(target, expected)) {
    log?.('frpc was removed or altered right after being written (security software?)');
    throw new FrpcInstallError('blocked', 'file removed after install');
  }
  return target;
}
