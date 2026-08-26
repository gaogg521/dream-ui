/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  net: {},
}));

const { handleMediaRequest, parseRangeHeader } = await import('@process/services/mediaProtocol');
const { buildMediaUrl } = await import('@/common/media/mediaUrl');

describe('parseRangeHeader', () => {
  it('parses a bounded range', () => {
    expect(parseRangeHeader('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
  });

  it('treats an open end as "to the last byte"', () => {
    expect(parseRangeHeader('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
  });

  it('parses a suffix range', () => {
    expect(parseRangeHeader('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
  });

  it('clamps an end past the file size', () => {
    expect(parseRangeHeader('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('rejects nonsense rather than guessing', () => {
    expect(parseRangeHeader(null, 100)).toBeNull();
    expect(parseRangeHeader('bytes=-', 100)).toBeNull();
    expect(parseRangeHeader('items=0-1', 100)).toBeNull();
    expect(parseRangeHeader('bytes=200-300', 100)).toBeNull(); // start past EOF
    expect(parseRangeHeader('bytes=50-10', 100)).toBeNull(); // inverted
  });
});

describe('handleMediaRequest', () => {
  let dir: string;
  let videoPath: string;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-proto-'));
    videoPath = path.join(dir, 'clip.mp4');
    await fs.promises.writeFile(videoPath, Buffer.from('0123456789'));
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  const get = (url: string, headers?: Record<string, string>) => handleMediaRequest(new Request(url, { headers }));

  it('streams the whole file with an Accept-Ranges hint', async () => {
    const res = await get(buildMediaUrl(videoPath));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(await res.text()).toBe('0123456789');
  });

  // Without a correct 206 a <video> element cannot seek.
  it('answers a range request with 206 and the exact slice', async () => {
    const res = await get(buildMediaUrl(videoPath), { Range: 'bytes=2-5' });
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(res.headers.get('Content-Length')).toBe('4');
    expect(await res.text()).toBe('2345');
  });

  // The extension allowlist is the security boundary: it keeps a compromised
  // renderer from reading source or credential files through this channel.
  it('refuses a non-media extension', async () => {
    const secret = path.join(dir, 'config.json');
    await fs.promises.writeFile(secret, '{"apiKey":"sk-secret"}');

    const res = await get(buildMediaUrl(secret));
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('sk-secret');
  });

  it('404s a missing file and a directory', async () => {
    expect((await get(buildMediaUrl(path.join(dir, 'gone.png')))).status).toBe(404);
    const subdir = path.join(dir, 'nested.png');
    await fs.promises.mkdir(subdir);
    expect((await get(buildMediaUrl(subdir))).status).toBe(404);
  });

  it('404s when no path is supplied', async () => {
    expect((await get('one-media://local/')).status).toBe(404);
  });
});
