/**
 * Copyright 2026 One Work
 *
 * Wire protocol of the One Work remote-access tunnel.
 *
 * One WebSocket (wss over the relay's normal 443) carries many independent HTTP
 * exchanges. Every WebSocket message is exactly one frame:
 *
 *   [type: u8][streamId: u32 BE][payload...]
 *
 * Control frames (HELLO / WELCOME / OPEN / HEAD / RESET) carry UTF-8 JSON; DATA carries
 * raw bytes; WINDOW carries a u32 BE credit. A "stream" is one visitor request: the relay
 * OPENs it, body bytes flow relay -> desktop, the desktop answers with HEAD then DATA, and
 * either side may END its direction or RESET the whole stream. A WebSocket the visitor
 * upgrades is the same stream after a 101 HEAD — raw bytes both ways.
 *
 * Flow control is credit based per stream direction (like HTTP/2): a sender may only send
 * as many DATA bytes as the receiver has granted, and the receiver grants more as its
 * consumer actually drains. One slow phone therefore never makes the relay buffer a large
 * download, and a stalled stream never blocks the others.
 *
 * Only the relay opens streams; the desktop never does. This module is shared by the
 * desktop client and the relay server so the two cannot drift apart.
 */

export const PROTOCOL_VERSION = 1;

export const FRAME = {
  /** desktop -> relay, first frame: who am I. */
  HELLO: 1,
  /** relay -> desktop: accepted. */
  WELCOME: 2,
  /** relay -> desktop: a visitor request starts. */
  OPEN: 3,
  /** desktop -> relay: the response head (or the 101 of an upgrade). */
  HEAD: 4,
  DATA: 5,
  /** The sender will send no more DATA in this direction. */
  END: 6,
  /** Abort the stream in both directions. */
  RESET: 7,
  /** Grant the peer more DATA credit. */
  WINDOW: 8,
} as const;

export type FrameType = (typeof FRAME)[keyof typeof FRAME];

/** WebSocket close codes with a meaning to the client (4000-4999 is application space). */
export const CLOSE_CODE = {
  /** Credentials refused (unknown, revoked, or wrong secret). Re-register once, do not loop. */
  REJECTED: 4401,
  /** A newer connection for the same tunnel took over. */
  REPLACED: 4409,
  /** Client and relay speak different protocol versions. */
  VERSION: 4426,
  /** The relay could not decide right now (credential service down). Transient. */
  UNAVAILABLE: 1013,
  /** The peer sent something that is not this protocol. */
  PROTOCOL: 1002,
} as const;

/** Where the relay accepts the control WebSocket (nginx routes this path on the main domain). */
export const TUNNEL_PATH = '/~!tunnel';

/** Credit every stream direction starts with (both ends assume it, nothing is sent for it). */
export const INITIAL_WINDOW = 256 * 1024;
/**
 * Most unread data one stream direction may hold. A receiver raises its window from
 * INITIAL_WINDOW towards this only while its consumer keeps up and the sender runs dry —
 * a fixed small window caps a long-distance link at window / round-trip time (256 KiB at
 * 80 ms is ~3 MB/s), while a stalled consumer never holds more than it has granted.
 */
export const MAX_WINDOW = 4 * 1024 * 1024;
/** Largest DATA payload in one frame; keeps one stream from monopolising the socket. */
export const MAX_DATA_CHUNK = 32 * 1024;
/** Hard cap for any single WebSocket message (control JSON included). */
export const MAX_MESSAGE_BYTES = 256 * 1024;
/** Streams the relay lets one tunnel run at once. */
export const DEFAULT_MAX_STREAMS = 128;

export type HelloMeta = { v: number; subdomain: string; secret: string };
export type WelcomeMeta = { v: number; maxStreams: number };

/** A visitor request. `headers` is a flat `[name, value, name, value...]` list: order and duplicates survive. */
export type OpenMeta = {
  method: string;
  url: string;
  headers: string[];
  /** Visitor address as seen by the relay's edge. Only the desktop decides what to make of it. */
  ip: string;
  upgrade: boolean;
};

export type HeadMeta = {
  status: number;
  message: string;
  headers: string[];
};

export type Frame = {
  type: FrameType;
  streamId: number;
  payload: Buffer;
};

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const KNOWN_TYPES = new Set<number>(Object.values(FRAME));
const HEADER_BYTES = 5;

export function encodeFrame(
  type: FrameType,
  streamId: number,
  payload?: Buffer | Uint8Array | object | string
): Buffer {
  let body: Buffer;
  if (payload === undefined) body = Buffer.alloc(0);
  else if (Buffer.isBuffer(payload)) body = payload;
  else if (payload instanceof Uint8Array) body = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  else if (typeof payload === 'string') body = Buffer.from(payload, 'utf8');
  else body = Buffer.from(JSON.stringify(payload), 'utf8');
  const out = Buffer.allocUnsafe(HEADER_BYTES + body.length);
  out.writeUInt8(type, 0);
  out.writeUInt32BE(streamId >>> 0, 1);
  body.copy(out, HEADER_BYTES);
  return out;
}

export function decodeFrame(data: Buffer): Frame {
  if (data.length < HEADER_BYTES) throw new ProtocolError('frame too short');
  if (data.length > MAX_MESSAGE_BYTES) throw new ProtocolError('frame too large');
  const type = data.readUInt8(0);
  if (!KNOWN_TYPES.has(type)) throw new ProtocolError(`unknown frame type ${type}`);
  return { type: type as FrameType, streamId: data.readUInt32BE(1), payload: data.subarray(HEADER_BYTES) };
}

export function parseJson<T>(payload: Buffer): Record<string, unknown> & Partial<T> {
  try {
    const value = JSON.parse(payload.toString('utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown> & Partial<T>;
  } catch {
    // fall through
  }
  throw new ProtocolError('invalid JSON payload');
}

const isHeaderList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length % 2 === 0 && value.every((v) => typeof v === 'string');

export function parseHello(payload: Buffer): HelloMeta {
  const m = parseJson<HelloMeta>(payload);
  if (typeof m.v !== 'number' || typeof m.subdomain !== 'string' || typeof m.secret !== 'string') {
    throw new ProtocolError('bad HELLO');
  }
  return { v: m.v, subdomain: m.subdomain, secret: m.secret };
}

export function parseWelcome(payload: Buffer): WelcomeMeta {
  const m = parseJson<WelcomeMeta>(payload);
  if (typeof m.v !== 'number') throw new ProtocolError('bad WELCOME');
  const maxStreams = typeof m.maxStreams === 'number' && m.maxStreams > 0 ? m.maxStreams : DEFAULT_MAX_STREAMS;
  return { v: m.v, maxStreams };
}

export function parseOpen(payload: Buffer): OpenMeta {
  const m = parseJson<OpenMeta>(payload);
  if (
    typeof m.method !== 'string' ||
    typeof m.url !== 'string' ||
    typeof m.ip !== 'string' ||
    typeof m.upgrade !== 'boolean' ||
    !isHeaderList(m.headers)
  ) {
    throw new ProtocolError('bad OPEN');
  }
  return { method: m.method, url: m.url, headers: m.headers, ip: m.ip, upgrade: m.upgrade };
}

export function parseHead(payload: Buffer): HeadMeta {
  const m = parseJson<HeadMeta>(payload);
  if (
    typeof m.status !== 'number' ||
    !Number.isInteger(m.status) ||
    m.status < 100 ||
    m.status > 599 ||
    typeof m.message !== 'string' ||
    !isHeaderList(m.headers)
  ) {
    throw new ProtocolError('bad HEAD');
  }
  return { status: m.status, message: m.message, headers: m.headers };
}

/** Hop-by-hop headers (RFC 9110 §7.6.1) never cross the tunnel; each hop frames its own message. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
]);

/**
 * Copy a raw header list, dropping hop-by-hop headers and anything in `drop` (lower-case names).
 * For an upgrade, `connection` and `upgrade` are kept — they are the point of the request.
 */
export function filterRawHeaders(
  raw: readonly string[],
  opts: { drop?: ReadonlySet<string>; keepUpgrade?: boolean } = {}
): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i];
    const lower = name.toLowerCase();
    if (opts.drop?.has(lower)) continue;
    if (HOP_BY_HOP.has(lower) && !(opts.keepUpgrade && lower === 'connection')) continue;
    if (lower === 'upgrade' && !opts.keepUpgrade) continue;
    out.push(name, raw[i + 1]);
  }
  return out;
}

/** Backoff between reconnect attempts of the desktop client: 2s, 5s, 15s, then 30s. */
export function reconnectDelayMs(attempt: number): number {
  const steps = [2000, 5000, 15000, 30000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)];
}
