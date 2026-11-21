/**
 * Copyright 2026 One Work
 *
 * The relay: runs on the public server (not in the app). Two loopback listeners, both
 * fronted by nginx (which terminates TLS):
 *
 * - control: desktops connect here over wss and authenticate with their tunnel secret;
 * - visitor: plain HTTP for `<subdomain>.<host>`; each request/upgrade is replayed through
 *   the matching desktop's tunnel.
 *
 * Who may connect is decided by the broker (`verify`), never here. The relay trusts nginx
 * for the visitor's address (`X-Real-IP`), which is why both listeners bind to loopback.
 */

import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { Mux, type MuxStream } from '../mux';
import {
  CLOSE_CODE,
  DEFAULT_MAX_STREAMS,
  FRAME,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ProtocolError,
  TUNNEL_PATH,
  decodeFrame,
  encodeFrame,
  filterRawHeaders,
  parseHello,
  type HeadMeta,
} from '../protocol';

export type VerifyResult = 'ok' | 'rejected' | 'unavailable' | 'replaced';

export type RelayOptions = {
  /** Parent host of tunnel subdomains, e.g. `r.1work.vip`. */
  subdomainHost: string;
  /** Asks the credential authority (the broker) whether this subdomain/secret pair is live. */
  verify: (
    subdomain: string,
    secret: string,
    kind: 'login' | 'recheck',
    connectionId?: string
  ) => Promise<VerifyResult>;
  /** HTML served (status 404) when the subdomain has no connected desktop. */
  offlinePage?: string;
  log?: (message: string) => void;
  maxStreams?: number;
  /** How often connected desktops are pinged / re-verified. */
  pingIntervalMs?: number;
  reverifyIntervalMs?: number;
  /** Give the desktop this long to send HELLO. */
  helloTimeoutMs?: number;
  /** Nothing from the desktop for this long (ping included) closes the tunnel. */
  deadAfterMs?: number;
  /** Private loopback peer reached through the encrypted inter-node transport. */
  peer?: { url: string; token: string };
};

class Session {
  readonly mux: Mux;
  alive = Date.now();
  constructor(
    readonly subdomain: string,
    /** Kept in memory only, to re-check revocation; never logged or persisted. */
    readonly secret: string,
    readonly ws: WebSocket,
    maxStreams: number,
    readonly connectionId: string
  ) {
    // The desktop never opens streams, so no `onStream`.
    this.mux = new Mux({
      send: (frame) => {
        if (ws.readyState === ws.OPEN) ws.send(frame);
      },
      maxStreams,
    });
  }
}

/** Headers the relay never forwards: the desktop sets its own authoritative copies. */
const STRIP = new Set([
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'forwarded',
  'expect',
  'x-onework-relay-token',
  'x-onework-peer',
]);

const OFFLINE_FALLBACK = '<!doctype html><meta charset="utf-8"><title>Offline</title><p>This computer is offline.';

export class RelayServer {
  private readonly sessions = new Map<string, Session>();
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  readonly controlServer: http.Server;
  readonly visitorServer: http.Server;
  private timers: NodeJS.Timeout[] = [];
  private readonly maxStreams: number;
  private readonly hostPattern: RegExp;
  private pendingHandshakes = 0;
  private readonly peerSockets = new Set<Duplex>();

  constructor(private readonly opts: RelayOptions) {
    this.maxStreams = opts.maxStreams ?? DEFAULT_MAX_STREAMS;
    const host = opts.subdomainHost.replace(/\./g, '\\.');
    this.hostPattern = new RegExp(`^([a-z0-9]{6,32})\\.${host}$`);

    this.controlServer = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: true, tunnels: this.sessions.size }));
        return;
      }
      res.writeHead(404).end();
    });
    this.controlServer.on('upgrade', (req, socket, head) => {
      if (req.url !== TUNNEL_PATH || this.pendingHandshakes >= 256) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onControlSocket(ws));
    });

    this.visitorServer = http.createServer((req, res) => this.onVisitorRequest(req, res));
    this.visitorServer.on('upgrade', (req, socket, head) => this.onVisitorUpgrade(req, socket, head));
    this.visitorServer.headersTimeout = 30_000;
    this.visitorServer.requestTimeout = 0;
  }

  async listen(control: { host: string; port: number }, visitor: { host: string; port: number }): Promise<void> {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.controlServer.once('error', reject);
        this.controlServer.listen(control.port, control.host, () => resolve());
      }),
      new Promise<void>((resolve, reject) => {
        this.visitorServer.once('error', reject);
        this.visitorServer.listen(visitor.port, visitor.host, () => resolve());
      }),
    ]);
    this.timers.push(
      setInterval(() => this.sweep(), this.opts.pingIntervalMs ?? 20_000),
      setInterval(() => void this.reverifyAll(), this.opts.reverifyIntervalMs ?? 60_000)
    );
  }

  /** Bound ports (useful when listening on port 0 in tests). */
  get ports(): { control: number; visitor: number } {
    return {
      control: (this.controlServer.address() as net.AddressInfo).port,
      visitor: (this.visitorServer.address() as net.AddressInfo).port,
    };
  }

  async close(): Promise<void> {
    for (const socket of this.peerSockets) socket.destroy();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const s of this.sessions.values()) s.ws.close(1001, 'relay shutting down');
    this.wss.close();
    this.controlServer.closeAllConnections?.();
    this.visitorServer.closeAllConnections?.();
    await Promise.all([
      new Promise((r) => this.controlServer.close(r)),
      new Promise((r) => this.visitorServer.close(r)),
    ]);
  }

  get tunnelCount(): number {
    return this.sessions.size;
  }

  private log(message: string): void {
    this.opts.log?.(message);
  }

  // ----- control channel -----

  private onControlSocket(ws: WebSocket): void {
    this.pendingHandshakes++;
    let settled = false;
    const settle = (): void => {
      if (!settled) {
        settled = true;
        this.pendingHandshakes--;
      }
    };
    const helloTimer = setTimeout(() => {
      settle();
      ws.close(CLOSE_CODE.PROTOCOL, 'hello timeout');
    }, this.opts.helloTimeoutMs ?? 10_000);
    let session: Session | null = null;
    let helloSeen = false;

    ws.on('message', async (data: Buffer) => {
      try {
        const buf = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);
        if (session) {
          session.alive = Date.now();
          session.mux.receive(buf);
          return;
        }
        if (helloSeen) throw new ProtocolError('frame before WELCOME');
        helloSeen = true;
        const frame = decodeFrame(buf);
        if (frame.type !== FRAME.HELLO) throw new ProtocolError('expected HELLO');
        const hello = parseHello(frame.payload);
        clearTimeout(helloTimer);
        settle();
        if (hello.v !== PROTOCOL_VERSION) {
          ws.close(CLOSE_CODE.VERSION, 'unsupported protocol version');
          return;
        }
        if (!/^[a-z0-9]{6,32}$/.test(hello.subdomain)) {
          ws.close(CLOSE_CODE.REJECTED, 'rejected');
          return;
        }
        const connectionId = randomUUID();
        const verdict = await this.opts.verify(hello.subdomain, hello.secret, 'login', connectionId);
        if (verdict === 'rejected') {
          this.log(`rejected login for ${hello.subdomain}`);
          ws.close(CLOSE_CODE.REJECTED, 'rejected');
          return;
        }
        if (verdict === 'replaced') {
          ws.close(CLOSE_CODE.REPLACED, 'replaced');
          return;
        }
        if (verdict === 'unavailable') {
          ws.close(CLOSE_CODE.UNAVAILABLE, 'try again later');
          return;
        }
        if (ws.readyState !== ws.OPEN) return;
        const previous = this.sessions.get(hello.subdomain);
        session = new Session(hello.subdomain, hello.secret, ws, this.maxStreams, connectionId);
        this.sessions.set(hello.subdomain, session);
        if (previous) {
          this.log(`tunnel ${hello.subdomain} taken over by a new connection`);
          previous.ws.close(CLOSE_CODE.REPLACED, 'replaced');
        }
        ws.send(encodeFrame(FRAME.WELCOME, 0, { v: PROTOCOL_VERSION, maxStreams: this.maxStreams }));
        this.log(`tunnel ${hello.subdomain} connected (${this.sessions.size} online)`);
      } catch (error) {
        if (error instanceof ProtocolError) ws.close(CLOSE_CODE.PROTOCOL, error.message.slice(0, 100));
        else {
          this.log(`control error: ${String(error)}`);
          ws.close(CLOSE_CODE.PROTOCOL, 'error');
        }
      }
    });
    ws.on('pong', () => {
      if (session) session.alive = Date.now();
    });
    ws.on('error', () => undefined);
    ws.on('close', () => {
      clearTimeout(helloTimer);
      settle();
      if (!session) return;
      session.mux.close();
      // A replacement may already be registered under the same name; only remove our own entry.
      if (this.sessions.get(session.subdomain) === session) {
        this.sessions.delete(session.subdomain);
        this.log(`tunnel ${session.subdomain} disconnected (${this.sessions.size} online)`);
      }
    });
  }

  /** Ping everyone; drop tunnels that went silent (no pong, no frame) so visitors get the offline page. */
  private sweep(): void {
    const dead = this.opts.deadAfterMs ?? 50_000;
    for (const s of this.sessions.values()) {
      if (Date.now() - s.alive > dead) {
        s.ws.terminate();
        continue;
      }
      try {
        s.ws.ping();
      } catch {
        s.ws.terminate();
      }
    }
  }

  /** Revoking a tunnel in the broker takes effect within one interval. A broker outage never kicks anyone. */
  private async reverifyAll(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values(), async (s) => {
        const verdict = await this.opts.verify(s.subdomain, s.secret, 'recheck', s.connectionId);
        if (verdict === 'rejected') {
          this.log(`tunnel ${s.subdomain} revoked`);
          s.ws.close(CLOSE_CODE.REJECTED, 'rejected');
        }
        if (verdict === 'replaced') s.ws.close(CLOSE_CODE.REPLACED, 'replaced by another region');
      })
    );
  }

  // ----- visitor traffic -----

  private lookup(req: http.IncomingMessage): Session | null | undefined {
    const host = (req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    const m = this.hostPattern.exec(host);
    if (!m) return undefined; // not a tunnel hostname at all
    return this.sessions.get(m[1]) ?? null; // null: valid name, desktop offline
  }

  private visitorIp(req: http.IncomingMessage): string {
    const claimed = String(req.headers['x-real-ip'] ?? '').trim();
    if (net.isIP(claimed)) return claimed;
    return (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  }

  private onVisitorRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.headers['x-onework-peer'] !== undefined && req.headers['x-onework-peer'] !== this.opts.peer?.token) {
      res.writeHead(403).end('invalid peer');
      return;
    }
    const session = this.lookup(req);
    if (session === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    if (session === null) {
      if (this.forwardToPeer(req, res)) return;
      res
        .writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        .end(this.opts.offlinePage ?? OFFLINE_FALLBACK);
      return;
    }
    const url = req.url ?? '/';
    if (!url.startsWith('/')) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (session.mux.activeStreams >= this.maxStreams) {
      res.writeHead(503, { 'retry-after': '2' }).end('busy');
      return;
    }

    let stream: MuxStream;
    try {
      stream = session.mux.open({
        method: req.method ?? 'GET',
        url,
        headers: filterRawHeaders(req.rawHeaders, { drop: STRIP }),
        ip: this.visitorIp(req),
        upgrade: false,
      });
    } catch {
      res.writeHead(502).end('tunnel closed');
      return;
    }

    let headSeen = false;
    stream.once('head', (head: HeadMeta) => {
      headSeen = true;
      res.writeHead(head.status, head.message, filterRawHeaders(head.headers));
      stream.pipe(res);
    });
    stream.on('error', () => {
      if (!headSeen && !res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }).end('bad gateway');
      else res.destroy();
    });
    // Visitor went away: tell the desktop to abandon the local request.
    res.on('close', () => {
      if (!res.writableFinished) stream.destroy();
    });
    req.pipe(stream);
    req.on('error', () => stream.destroy());
  }

  private onVisitorUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const reply = (status: string, body = ''): void => {
      socket.end(
        `HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: ${Buffer.byteLength(body)}\r\ncontent-type: text/plain\r\n\r\n${body}`
      );
    };
    const session = this.lookup(req);
    if (req.headers['x-onework-peer'] !== undefined && req.headers['x-onework-peer'] !== this.opts.peer?.token) {
      return reply('403 Forbidden', 'invalid peer');
    }
    if (session === undefined) return reply('404 Not Found', 'not found');
    if (session === null) {
      if (this.forwardToPeer(req, socket, head)) return;
      return reply('404 Not Found', 'offline');
    }
    const url = req.url ?? '/';
    if (!url.startsWith('/')) return reply('400 Bad Request');
    if (session.mux.activeStreams >= this.maxStreams) return reply('503 Service Unavailable', 'busy');

    let stream: MuxStream;
    try {
      stream = session.mux.open({
        method: req.method ?? 'GET',
        url,
        headers: filterRawHeaders(req.rawHeaders, { drop: STRIP, keepUpgrade: true }),
        ip: this.visitorIp(req),
        upgrade: true,
      });
    } catch {
      return reply('502 Bad Gateway', 'tunnel closed');
    }

    let upgraded = false;
    let headSeen = false;
    stream.once('head', (meta: HeadMeta) => {
      headSeen = true;
      const lines = [`HTTP/1.1 ${meta.status} ${meta.message}`];
      for (let i = 0; i + 1 < meta.headers.length; i += 2) lines.push(`${meta.headers[i]}: ${meta.headers[i + 1]}`);
      if (meta.status === 101) {
        upgraded = true;
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        stream.pipe(socket);
        socket.pipe(stream);
        // Bytes the visitor sent right behind its handshake.
        if (head.length) stream.write(head);
      } else {
        // The WebUI declined the upgrade: pass its answer on as an ordinary response.
        lines.push('connection: close');
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        stream.pipe(socket);
      }
    });
    stream.on('error', () => {
      if (!headSeen) reply('502 Bad Gateway', 'bad gateway');
      else socket.destroy();
    });
    stream.on('close', () => {
      if (upgraded) socket.destroy();
      else if (headSeen) socket.end();
    });
    socket.on('error', () => stream.destroy());
    socket.on('close', () => stream.destroy());
    // Unlike a plain request, an upgraded stream stays open for bytes in both directions,
    // so the relay's side is not ended here.
  }

  /** The authenticated session owns this hostname. Try the other node once if absent here. */
  private forwardToPeer(req: http.IncomingMessage, target: http.ServerResponse | Duplex, head?: Buffer): boolean {
    const peer = this.opts.peer;
    // NGINX clears this private header at public ingress. Only the loopback peer sets it.
    if (!peer || req.headers['x-onework-peer'] !== undefined) return false;
    const headers = filterRawHeaders(req.rawHeaders, {
      drop: new Set([...STRIP, 'x-onework-peer']),
      keepUpgrade: head !== undefined,
    });
    headers.push('X-OneWork-Peer', peer.token, 'X-Real-IP', this.visitorIp(req));
    const url = new URL(peer.url);
    const proxy = http.request({
      hostname: url.hostname,
      port: url.port,
      method: req.method,
      path: req.url,
      headers,
      agent: false,
    });
    let answered = false;
    let timer: NodeJS.Timeout | undefined;
    proxy.once('finish', () => {
      if (!answered) timer = setTimeout(() => proxy.destroy(new Error('peer response timeout')), 30_000);
    });
    const fail = (): void => {
      clearTimeout(timer);
      if (target instanceof http.ServerResponse && !target.headersSent) target.writeHead(502).end('peer unavailable');
      else target.destroy();
    };
    proxy.on('error', fail);
    proxy.on('response', (response) => {
      answered = true;
      clearTimeout(timer);
      if (target instanceof http.ServerResponse) {
        target.writeHead(response.statusCode ?? 502, filterRawHeaders(response.rawHeaders));
      } else {
        const raw = filterRawHeaders(response.rawHeaders);
        const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
        for (let i = 0; i < raw.length; i += 2) lines.push(`${raw[i]}: ${raw[i + 1]}`);
        lines.push('Connection: close');
        target.write(lines.join('\r\n') + '\r\n\r\n');
      }
      response.on('error', fail);
      response.pipe(target);
    });
    proxy.on('upgrade', (response, socket, rest) => {
      answered = true;
      clearTimeout(timer);
      if (target instanceof http.ServerResponse) {
        socket.destroy();
        fail();
        return;
      }
      const raw = filterRawHeaders(response.rawHeaders, { keepUpgrade: true });
      const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
      for (let i = 0; i < raw.length; i += 2) lines.push(`${raw[i]}: ${raw[i + 1]}`);
      target.write(lines.join('\r\n') + '\r\n\r\n');
      this.peerSockets.add(socket);
      socket.on('close', () => {
        this.peerSockets.delete(socket);
        target.destroy();
      });
      socket.on('error', fail);
      target.on('close', () => socket.destroy());
      target.on('error', () => socket.destroy());
      if (rest.length) target.write(rest);
      if (head?.length) socket.write(head);
      socket.pipe(target);
      target.pipe(socket);
    });
    target.on('close', () => {
      clearTimeout(timer);
      proxy.destroy();
    });
    req.on('error', () => proxy.destroy());
    proxy.on('close', () => {
      clearTimeout(timer);
      if (!answered) fail();
    });
    if (head === undefined) req.pipe(proxy);
    else proxy.end();
    return true;
  }
}
