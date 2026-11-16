import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  downloadFrpc,
  findInstalledFrpc,
  FRPC_BINARY_SHA256,
  FRPC_VERSION,
  FrpcInstallError,
  installedFrpcPath,
  sha256Hex,
} from '../../packages/desktop/src/process/services/remoteTunnel/frpcComponent';

const BODY = Buffer.from('pretend this is frpc');
const GOOD = sha256Hex(BODY);

const reply = (status: number, body: Buffer = BODY) =>
  ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => body }) as unknown as Response;

describe('frpcComponent', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frpc-comp-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const opts = (fetchImpl: (url: string) => Promise<Response>, extra = {}) => ({
    dataDir: dir,
    platform: 'linux',
    arch: 'x64',
    fetch: fetchImpl as unknown as typeof fetch,
    bases: ['https://a.test/frpc', 'https://b.test/frpc'],
    expectedSha256: GOOD,
    settleMs: 0,
    ...extra,
  });

  it('pins a hash for every platform the app ships on', () => {
    for (const key of ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']) {
      expect(FRPC_BINARY_SHA256[key]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('downloads from the first host, verifies it, and installs under the data dir', async () => {
    const urls: string[] = [];
    const file = await downloadFrpc(
      opts(async (url) => {
        urls.push(url);
        return reply(200);
      })
    );
    expect(file).toBe(installedFrpcPath(dir, 'linux', 'x64'));
    expect(fs.readFileSync(file)).toEqual(BODY);
    expect(urls).toEqual([`https://a.test/frpc/${FRPC_VERSION}/linux-x64/frpc`]);
    expect(fs.existsSync(`${file}.part`)).toBe(false);
  });

  it('falls through to the next host on HTTP errors, network errors and checksum mismatches', async () => {
    const calls: string[] = [];
    const file = await downloadFrpc(
      opts(async (url) => {
        calls.push(url);
        if (url.startsWith('https://a.test')) return reply(200, Buffer.from('tampered'));
        return reply(200);
      })
    );
    expect(calls).toHaveLength(2);
    expect(fs.readFileSync(file)).toEqual(BODY);

    fs.rmSync(file);
    await expect(
      downloadFrpc(
        opts(async (url) => {
          if (url.startsWith('https://a.test')) throw new Error('ECONNRESET');
          return reply(404);
        })
      )
    ).rejects.toMatchObject({ code: 'download_failed' });
  });

  it('never installs a binary that does not match the pinned hash', async () => {
    await expect(downloadFrpc(opts(async () => reply(200, Buffer.from('evil'))))).rejects.toBeInstanceOf(
      FrpcInstallError
    );
    expect(fs.existsSync(installedFrpcPath(dir, 'linux', 'x64'))).toBe(false);
  });

  it('reports blocked when the file disappears right after being written (antivirus)', async () => {
    const target = installedFrpcPath(dir, 'linux', 'x64');
    const fetchImpl = async () => {
      // Simulate a real-time scanner: remove the file as soon as it lands.
      setTimeout(() => fs.rmSync(target, { force: true }), 5);
      return reply(200);
    };
    await expect(downloadFrpc(opts(fetchImpl, { settleMs: 60 }))).rejects.toMatchObject({ code: 'blocked' });
  });

  it('findInstalledFrpc only trusts a file that still matches the pinned hash', async () => {
    const key = 'linux-x64';
    const original = FRPC_BINARY_SHA256[key];
    FRPC_BINARY_SHA256[key] = GOOD;
    try {
      expect(findInstalledFrpc(dir, 'linux', 'x64')).toBeNull();
      await downloadFrpc(opts(async () => reply(200)));
      expect(findInstalledFrpc(dir, 'linux', 'x64')).toBe(installedFrpcPath(dir, 'linux', 'x64'));

      fs.writeFileSync(installedFrpcPath(dir, 'linux', 'x64'), 'swapped');
      expect(findInstalledFrpc(dir, 'linux', 'x64')).toBeNull();
    } finally {
      FRPC_BINARY_SHA256[key] = original;
    }
  });

  it('refuses an unsupported platform instead of guessing a URL', async () => {
    await expect(
      downloadFrpc({ ...opts(async () => reply(200)), platform: 'freebsd', expectedSha256: undefined })
    ).rejects.toMatchObject({ code: 'download_failed' });
  });
});
