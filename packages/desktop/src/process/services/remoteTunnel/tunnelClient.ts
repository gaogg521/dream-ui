/**
 * Copyright 2026 One Work
 *
 * One connection of the desktop side of the tunnel: dial the relay over wss, authenticate,
 * then answer each visitor request by replaying it against this machine's WebUI
 * (127.0.0.1:<port>) and streaming the answer back. Runs in the Electron main process —
 * no helper executable. Reconnection policy lives in RemoteTunnel, not here.
 */

import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import { Mux, type MuxStream } from './mux';
import {
  CLOSE_CODE,
  FRAME,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  TUNNEL_PATH,
  decodeFrame,
  encodeFrame,
  filterRawHeaders,
  parseWelcome,
  type OpenMeta,
} from './protocol';

/** Header every forwarded request carries so web-host can trust `X-Real-IP` (see web-host/client-ip.ts). */
export const RELAY_TOKEN_HEADER = 'x-onework-relay-token';

export type TunnelClientOptions = {
  serverAddr: string;
  serverPort: number;
  subdomain: string;
  secret: string;
  /** Port of the local WebUI to expose. */
  localPort: number;
  /** Per-process secret stamped on every forwarded request. */
  relayToken: string;
  /** Test seam; defaults to the `ws` client. */
  createSocket?: (url: string) => WebSocket;
  log?: (message: string) => void;
  /** The relay must answer HELLO within this long. */
  handshakeTimeoutMs?: number;
  /** No frame and no ping for this long means the connection is dead. */
  idleTimeoutMs?: number;
};

export type TunnelCloseInfo = {
  code: number;
  reason: string;
  /** Credentials were refused: unknown, revoked or wrong secret. */
  rejected: boolean;
  /** Another connection took this tunnel over. */
  replaced: boolean;
  /** The handshake had completed before the connection ended. */
  wasConnected: boolean;
};

type Events = {
  connected: [];
  closed: [TunnelCloseInfo];
};

/** Request headers the desktop sets itself; whatever a visitor sent under these names is discarded. */
const OWNED_HEADERS = new Set([RELAY_TOKEN_HEADER, 'x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'forwarded']);

/** Flat `[name, value, ...]` list to the object form `http.request` takes; repeated names become arrays. */
function toHeaderObject(flat: readonly string[]): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const name = flat[i];
    const key = name.toLowerCase();
    const existing = out[key];
    if (existing === undefined) out[key] = flat[i + 1];
    else out[key] = [...(Array.isArray(existing) ? existing : [String(existing)]), flat[i + 1]];
  }
  return out;
}

export function tunnelUrl(serverAddr: string, serverPort: number): string {
  const host = serverAddr.includes(':') ? `[${serverAddr}]` : serverAddr;
  return `wss://${host}${serverPort === 443 ? '' : `:${serverPort}`}${TUNNEL_PATH}`;
}

export class TunnelClient extends EventEmitter<Events> {
  private ws: WebSocket | null = null;
  private mux: Mux | null = null;
  private connected = false;
  private finished = false;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TunnelClientOptions) {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Dial and authenticate. Resolves nothing: watch `connected` / `closed`. */
  start(): void {
    const url = tunnelUrl(this.opts.serverAddr, this.opts.serverPort);
    const ws = this.opts.createSocket
      ? this.opts.createSocket(url)
      : new WebSocket(url, {
          handshakeTimeout: 15_000,
          maxPayload: MAX_MESSAGE_BYTES,
          perMessageDeflate: false,
          headers: { 'User-Agent': 'OneWork-Tunnel/1' },
        });
    this.ws = ws;
    const mux = new Mux({
      send: (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      },
      onStream: (stream, meta) => this.serve(stream, meta),
      maxStreams: 256,
    });
    this.mux = mux;

    this.handshakeTimer = setTimeout(
      () => this.fail(CLOSE_CODE.UNAVAILABLE, 'handshake timeout'),
      this.opts.handshakeTimeoutMs ?? 15_000
    );

    ws.on('open', () => {
      ws.send(
        encodeFrame(FRAME.HELLO, 0, { v: PROTOCOL_VERSION, subdomain: this.opts.subdomain, secret: this.opts.secret })
      );
      this.touch();
    });
    ws.on('message', (data: WebSocket.RawData) => {
      this.touch();
      const buf = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
      try {
        if (!this.connected) {
          this.onFirstFrame(buf);
        } else {
          mux.receive(buf);
        }
      } catch (error) {
        if (error instanceof ProtocolError) this.fail(CLOSE_CODE.PROTOCOL, error.message);
        else throw error;
      }
    });
    ws.on('ping', () => this.touch());
    ws.on('error', (error) => this.opts.log?.(`socket error: ${error.message}`));
    ws.on('close', (code, reason) => this.finish(code, reason.toString('utf8')));
  }

  /** Drop the connection. Emits `closed` once. */
  stop(): void {
    this.fail(1000, 'client stop');
  }

  private onFirstFrame(buf: Buffer): void {
    const frame = decodeFrame(buf);
    if (frame.type !== FRAME.WELCOME) throw new ProtocolError('expected WELCOME');
    const welcome = parseWelcome(frame.payload);
    if (welcome.v !== PROTOCOL_VERSION) throw new ProtocolError('protocol version mismatch');
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    this.connected = true;
    this.emit('connected');
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // The relay pings every ~20s, so a minute of silence means the path is dead (sleep, NAT drop).
    this.idleTimer = setTimeout(
      () => this.fail(CLOSE_CODE.UNAVAILABLE, 'idle timeout'),
      this.opts.idleTimeoutMs ?? 60_000
    );
  }

  private fail(code: number, reason: string): void {
    const ws = this.ws;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(code, reason);
    } catch {
      // ignore: terminate below
    }
    // A half-open connection never completes the close handshake; do not wait for it.
    setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // already gone
      }
    }, 1000).unref?.();
    this.finish(code, reason);
  }

  private finish(code: number, reason: string): void {
    if (this.finished) return;
    this.finished = true;
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.mux?.close();
    this.emit('closed', {
      code,
      reason,
      rejected: code === CLOSE_CODE.REJECTED,
      replaced: code === CLOSE_CODE.REPLACED,
      wasConnected: this.connected,
    });
    this.connected = false;
  }

  // ----- serving one visitor request -----

  private serve(stream: MuxStream, meta: OpenMeta): void {
    const log = this.opts.log;
    if (!meta.url.startsWith('/')) {
      stream.destroy(new Error('bad request target'));
      return;
    }
    const visitorIp = net.isIP(meta.ip) ? meta.ip : '';
    const headers = filterRawHeaders(meta.headers, { drop: OWNED_HEADERS, keepUpgrade: meta.upgrade });
    // The token is what lets web-host believe the address below. It can only be set here:
    // anything the visitor sent under these names was dropped above.
    headers.push(RELAY_TOKEN_HEADER, this.opts.relayToken);
    if (visitorIp) headers.push('x-real-ip', visitorIp, 'x-forwarded-for', visitorIp);
    headers.push('x-forwarded-proto', 'https');

    let headSent = false;
    const req = http.request({
      host: '127.0.0.1',
      port: this.opts.localPort,
      method: meta.method,
      path: meta.url,
      headers: toHeaderObject(headers),
      agent: false,
    });

    // The visitor's body (if any) flows relay -> stream -> local request. An upgrade has no
    // body and its stream carries raw socket bytes later, so it is not piped into the request.
    if (meta.upgrade) req.end();
    else stream.pipe(req);

    req.on('response', (res) => {
      headSent = true;
      stream.sendHead({
        status: res.statusCode ?? 502,
        message: res.statusMessage ?? '',
        headers: filterRawHeaders(res.rawHeaders),
      });
      res.pipe(stream);
      res.on('error', () => stream.destroy());
    });
    req.on('upgrade', (res, socket, rest) => {
      headSent = true;
      stream.sendHead({
        status: res.statusCode ?? 101,
        message: res.statusMessage ?? '',
        headers: filterRawHeaders(res.rawHeaders, { keepUpgrade: true }),
      });
      if (rest.length) stream.write(rest);
      stream.pipe(socket);
      socket.pipe(stream);
      const down = (): void => {
        socket.destroy();
        stream.destroy();
      };
      socket.on('error', down);
      stream.on('error', down);
      stream.on('close', () => socket.destroy());
    });
    req.on('error', (error) => {
      log?.(`local request failed: ${error.message}`);
      // Before the head, the relay turns a reset into a 502 for the visitor.
      stream.destroy(new Error(headSent ? 'local connection lost' : 'local WebUI unreachable'));
    });
    stream.on('error', () => req.destroy());
    stream.on('close', () => {
      if (!req.destroyed && !req.writableEnded) req.destroy();
    });
  }
}
