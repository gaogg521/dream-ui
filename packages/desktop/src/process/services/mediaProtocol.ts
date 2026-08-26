/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `one-media://` — a range-capable read-only stream for generated media files.
 *
 * Why this exists: the renderer runs on `http://localhost:5173` (dev) with
 * webSecurity on, so `file://` URLs are blocked — verified on a real window,
 * both `<img src>` and `fetch()` fail. Images work around this today by
 * base64-ing through `/api/fs/image-base64`, which is fine for a ~1MB PNG but
 * is exactly what the D6 rule forbids for video: a 30MB clip must not be
 * serialized through the IPC/TCP layer (see the 2026-04-14 commit-charge
 * incident recorded in the media design doc).
 *
 * A protocol handler keeps that rule intact. Bytes go straight from disk to the
 * media element as a stream, never crossing a message channel, and `Range`
 * support is what makes seeking in a `<video>` element work at all.
 *
 * Security boundary: this serves any readable regular file whose extension is a
 * known image/video type. The extension allowlist is the guard — it keeps a
 * compromised renderer from reading source, config, or credential files through
 * this channel. It intentionally does NOT try to confine reads to workspace
 * directories: generated media lands in whatever workspace the agent was given,
 * and there is no central registry of those paths to check against.
 */

import { protocol, net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, VIDEO_EXTENSIONS, VIDEO_MIME_TYPE_MAP } from '@/common/config/constants';
import { MEDIA_PROTOCOL_SCHEME } from '@/common/media/mediaUrl';

export { MEDIA_PROTOCOL_SCHEME };

const SERVABLE_EXTENSIONS = new Set<string>([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

const mimeTypeFor = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPE_MAP[ext] || VIDEO_MIME_TYPE_MAP[ext] || 'application/octet-stream';
};

/**
 * Must run before `app` emits `ready`. `stream: true` is what allows partial
 * responses; without `supportFetchAPI` the renderer cannot probe the URL.
 */
export const registerMediaProtocolScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false },
    },
  ]);
};

type RangeSpec = { start: number; end: number };

/** Parse a single-range `bytes=` header. Multi-range is not supported (media elements never send one). */
export const parseRangeHeader = (header: string | null, size: number): RangeSpec | null => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  // `bytes=-N` means the trailing N bytes.
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
};

const notFound = (reason: string): Response => new Response(reason, { status: 404 });

export const handleMediaRequest = async (request: Request): Promise<Response> => {
  let target: string | null = null;
  try {
    target = new URL(request.url).searchParams.get('path');
  } catch {
    return notFound('bad url');
  }
  if (!target) return notFound('missing path');

  const resolved = path.resolve(target);
  if (!SERVABLE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    return new Response('unsupported media type', { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    return notFound('not found');
  }
  if (!stat.isFile()) return notFound('not a file');

  const mimeType = mimeTypeFor(resolved);
  const range = parseRangeHeader(request.headers.get('Range'), stat.size);

  if (range) {
    const stream = fs.createReadStream(resolved, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const stream = fs.createReadStream(resolved);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  });
};

/** Must run after `app` is ready. */
export const installMediaProtocolHandler = (): void => {
  // `net` is imported so this module fails loudly at import time if the Electron
  // surface it needs is missing, rather than at first playback.
  void net;
  protocol.handle(MEDIA_PROTOCOL_SCHEME, handleMediaRequest);
};
