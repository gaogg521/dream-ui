/**
 * The real relay and the real desktop client talking over a real loopback WebSocket, with a
 * fake WebUI behind the client. Nothing in the tunnel is mocked.
 */
import http from 'node:http';
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TunnelClient,
  RELAY_TOKEN_HEADER,
  tunnelUrl,
  type TunnelCloseInfo,
} from '@process/services/remoteTunnel/tunnelClient';
import { RelayServer, type VerifyResult } from '@process/services/remoteTunnel/relay/server';
import { CLOSE_CODE, FRAME, PROTOCOL_VERSION, TUNNEL_PATH, encodeFrame } from '@process/services/remoteTunnel/protocol';

const HOST = 'r.test';
const SUB = 'abcdef123456';
const SECRET = 'rts_secret';
const TOKEN = 'per-launch-relay-token';

type Fixture = {
  relay: RelayServer;
  upstream: http.Server;
  upstreamPort: number;
  verifyCalls: Array<[string, string]>;
  setVerdict: (v: VerifyResult) => void;
  clients: TunnelClient[];
  connect: (overrides?: { secret?: string; subdomain?: string }) => Promise<TunnelClient>;
};

let fx: Fixture;

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));

function startUpstream(): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/headers') {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] });
      res.end(JSON.stringify({ method: req.method, url, headers: req.headers }));
      return;
    }
    if (url === '/echo') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(createHash('sha256').update(body).digest('hex') + ':' + body.length);
      });
      return;
    }
    if (url.startsWith('/big')) {
      const total = Number(new URL(url, 'http://x').searchParams.get('mb') ?? '16') * 1024 * 1024;
      res.writeHead(200, { 'content-length': String(total) });
      let sent = 0;
      const hash = createHash('sha256');
      const write = (): void => {
        while (sent < total) {
          const n = Math.min(64 * 1024, total - sent);
          const chunk = Buffer.alloc(n, sent % 251);
          hash.update(chunk);
          sent += n;
          bigSent = sent;
          if (!res.write(chunk)) {
            res.once('drain', write);
            return;
          }
        }
        res.end();
      };
      write();
      return;
    }
    if (url === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: one\n\n');
      setTimeout(() => {
        res.write('data: two\n\n');
        res.end();
      }, 150);
      return;
    }
    if (url === '/hang') {
      res.writeHead(200);
      res.write('start');
      req.on('close', () => upstreamAborts.push(url));
      return;
    }
    if (url === '/nope') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such page');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('hello from the webui');
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    ws.send(JSON.stringify({ hello: true, realIp: req.headers['x-real-ip'] }));
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
  });
  return server;
}

const upstreamAborts: string[] = [];
let bigSent = 0;

beforeEach(async () => {
  upstreamAborts.length = 0;
  const upstream = startUpstream();
  const upstreamPort = await listen(upstream);
  let verdict: VerifyResult = 'ok';
  const verifyCalls: Array<[string, string]> = [];
  const relay = new RelayServer({
    subdomainHost: HOST,
    verify: async (sub, secret) => {
      verifyCalls.push([sub, secret]);
      if (verdict !== 'ok') return verdict;
      return sub === SUB && secret === SECRET ? 'ok' : 'rejected';
    },
    offlinePage: '<h1>offline</h1>',
    pingIntervalMs: 200,
    reverifyIntervalMs: 200,
  });
  await relay.listen({ host: '127.0.0.1', port: 0 }, { host: '127.0.0.1', port: 0 });
  const clients: TunnelClient[] = [];
  fx = {
    relay,
    upstream,
    upstreamPort,
    verifyCalls,
    setVerdict: (v) => {
      verdict = v;
    },
    clients,
    connect: async (overrides = {}) => {
      const client = new TunnelClient({
        serverAddr: '127.0.0.1',
        serverPort: relay.ports.control,
        subdomain: overrides.subdomain ?? SUB,
        secret: overrides.secret ?? SECRET,
        localPort: upstreamPort,
        relayToken: TOKEN,
        createSocket: (url) => new WebSocket(url.replace(/^wss:/, 'ws:')),
        handshakeTimeoutMs: 3000,
      });
      clients.push(client);
      const ready = new Promise<void>((resolve, reject) => {
        client.once('connected', () => resolve());
        client.once('closed', (info) => reject(new Error(`closed ${info.code} ${info.reason}`)));
      });
      client.start();
      await ready;
      return client;
    },
  };
});

afterEach(async () => {
  for (const c of fx.clients) c.stop();
  await fx.relay.close();
  await new Promise((r) => {
    fx.upstream.closeAllConnections();
    fx.upstream.close(r);
  });
});

type VisitorResponse = { status: number; headers: http.IncomingHttpHeaders; rawHeaders: string[]; body: Buffer };

function visit(
  path: string,
  opts: { method?: string; body?: Buffer | string; headers?: Record<string, string>; host?: string } = {}
): Promise<VisitorResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: fx.relay.ports.visitor,
        method: opts.method ?? 'GET',
        path,
        headers: { host: opts.host ?? `${SUB}.${HOST}`, ...opts.headers },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            rawHeaders: res.rawHeaders,
            body: Buffer.concat(chunks),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

describe('tunnel relay <-> client', () => {
  it('builds the wss url, hiding the default port', () => {
    expect(tunnelUrl('1work.vip', 443)).toBe(`wss://1work.vip${TUNNEL_PATH}`);
    expect(tunnelUrl('1work.vip', 8443)).toBe(`wss://1work.vip:8443${TUNNEL_PATH}`);
  });

  it('serves a plain request through the tunnel', async () => {
    await fx.connect();
    const res = await visit('/');
    expect(res.body.toString()).toBe('hello from the webui');
    expect(res.status).toBe(200);
    expect(fx.relay.tunnelCount).toBe(1);
  });

  it('passes upstream status and body untouched (404 from the WebUI is not the offline page)', async () => {
    await fx.connect();
    const res = await visit('/nope');
    expect(res.status).toBe(404);
    expect(res.body.toString()).toBe('no such page');
  });

  it('shows the offline page when no desktop is connected, and 404 for non-tunnel hosts', async () => {
    const offline = await visit('/');
    expect(offline.status).toBe(404);
    expect(offline.body.toString()).toBe('<h1>offline</h1>');
    const stranger = await visit('/', { host: 'example.com' });
    expect(stranger.status).toBe(404);
    expect(stranger.body.toString()).toBe('not found');
  });

  it('stamps the relay token and the real visitor address, discarding forged headers', async () => {
    await fx.connect();
    const res = await visit('/headers', {
      headers: {
        'x-real-ip': '203.0.113.9',
        'x-forwarded-for': '6.6.6.6',
        [RELAY_TOKEN_HEADER]: 'forged',
        cookie: 'sid=1',
      },
    });
    const seen = JSON.parse(res.body.toString()).headers as Record<string, string>;
    // nginx's X-Real-IP is what the relay forwards as the visitor address...
    expect(seen['x-real-ip']).toBe('203.0.113.9');
    expect(seen['x-forwarded-for']).toBe('203.0.113.9');
    // ...but only the desktop's own token ever reaches the WebUI.
    expect(seen[RELAY_TOKEN_HEADER]).toBe(TOKEN);
    expect(seen.cookie).toBe('sid=1');
    expect(seen['x-forwarded-proto']).toBe('https');
    expect(seen.host).toBe(`${SUB}.${HOST}`);
  });

  it('falls back to the socket peer when the edge sent no valid X-Real-IP', async () => {
    await fx.connect();
    const res = await visit('/headers', { headers: { 'x-real-ip': 'not-an-ip' } });
    const seen = JSON.parse(res.body.toString()).headers as Record<string, string>;
    expect(seen['x-real-ip']).toBe('127.0.0.1');
  });

  it('keeps repeated response headers such as Set-Cookie', async () => {
    await fx.connect();
    const res = await visit('/headers');
    expect(res.headers['set-cookie']).toEqual(['a=1', 'b=2']);
  });

  it('streams a request body both ways and preserves it exactly', async () => {
    await fx.connect();
    const body = randomBytes(3 * 1024 * 1024 + 17);
    const res = await visit('/echo', { method: 'POST', body, headers: { 'content-length': String(body.length) } });
    expect(res.body.toString()).toBe(`${createHash('sha256').update(body).digest('hex')}:${body.length}`);
  });

  it('delivers a large response intact (flow control does not stall or corrupt)', async () => {
    await fx.connect();
    const res = await visit('/big?mb=24');
    expect(res.body.length).toBe(24 * 1024 * 1024);
    const expected = createHash('sha256');
    for (let sent = 0; sent < res.body.length; sent += 64 * 1024) expected.update(Buffer.alloc(64 * 1024, sent % 251));
    expect(createHash('sha256').update(res.body).digest('hex')).toBe(expected.digest('hex'));
  }, 30_000);

  it('applies backpressure: a visitor that stops reading does not make the relay buffer the download', async () => {
    bigSent = 0;
    await fx.connect();
    const socket = net.connect(fx.relay.ports.visitor, '127.0.0.1');
    socket.write(`GET /big?mb=64 HTTP/1.1\r\nHost: ${SUB}.${HOST}\r\n\r\n`);
    socket.pause();
    await new Promise((r) => setTimeout(r, 800));
    // The visitor read nothing, so credit ran out and the WebUI was held back long before 64 MiB
    // (what is in flight is bounded by the stream window plus kernel socket buffers).
    expect(bigSent).toBeGreaterThan(0);
    expect(bigSent).toBeLessThan(40 * 1024 * 1024);
    let received = 0;
    await new Promise<void>((resolve) => {
      socket.on('data', (c) => {
        received += c.length;
        if (received > 64 * 1024 * 1024) resolve();
      });
      socket.resume();
    });
    socket.destroy();
  }, 30_000);

  it('streams incrementally (SSE-style) instead of buffering the response', async () => {
    await fx.connect();
    const first = await new Promise<number>((resolve) => {
      const started = Date.now();
      const req = http.request(
        {
          host: '127.0.0.1',
          port: fx.relay.ports.visitor,
          path: '/stream',
          headers: { host: `${SUB}.${HOST}` },
          agent: false,
        },
        (res) => {
          res.once('data', () => {
            resolve(Date.now() - started);
            res.destroy();
          });
        }
      );
      req.end();
    });
    expect(first).toBeLessThan(120);
  });

  it('relays WebSocket upgrades in both directions with the visitor address', async () => {
    await fx.connect();
    const ws = new WebSocket(`ws://127.0.0.1:${fx.relay.ports.visitor}/ws`, {
      headers: { host: `${SUB}.${HOST}`, 'x-real-ip': '198.51.100.7' },
    });
    const messages: string[] = [];
    ws.on('message', (d) => messages.push(d.toString()));
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', reject);
    });
    ws.send('ping-text');
    const bin = randomBytes(300 * 1024);
    const echoed = new Promise<Buffer>((resolve) =>
      ws.on('message', (d, isBinary) => {
        if (isBinary) resolve(d as Buffer);
      })
    );
    ws.send(bin);
    expect(Buffer.compare(await echoed, bin)).toBe(0);
    expect(JSON.parse(messages[0]).realIp).toBe('198.51.100.7');
    expect(messages).toContain('ping-text');
    ws.close();
    await new Promise((r) => ws.on('close', r));
  });

  it('passes a refused upgrade (upstream says no) back as an ordinary response', async () => {
    await fx.connect();
    const ws = new WebSocket(`ws://127.0.0.1:${fx.relay.ports.visitor}/nope`, { headers: { host: `${SUB}.${HOST}` } });
    const status = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });
    // The fake WebUI's ws server refuses non-/ws paths with 400; the point is that it arrives intact.
    expect(status).toBe(400);
  });

  it('cancels the local request when the visitor goes away', async () => {
    await fx.connect();
    await new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: fx.relay.ports.visitor,
          path: '/hang',
          headers: { host: `${SUB}.${HOST}` },
          agent: false,
        },
        (res) => {
          res.once('data', () => {
            res.destroy();
            resolve();
          });
        }
      );
      req.end();
    });
    await vi_waitFor(() => upstreamAborts.length === 1);
  });

  it('answers 502 when the local WebUI is not listening', async () => {
    const client = await fx.connect();
    expect(client.isConnected).toBe(true);
    await new Promise((r) => {
      fx.upstream.closeAllConnections();
      fx.upstream.close(r);
    });
    const res = await visit('/');
    expect(res.status).toBe(502);
    // Reopen so afterEach can close cleanly.
    fx.upstream = http.createServer();
  });

  it('rejects wrong credentials with the REJECTED close code and registers nothing', async () => {
    const client = new TunnelClient({
      serverAddr: '127.0.0.1',
      serverPort: fx.relay.ports.control,
      subdomain: SUB,
      secret: 'wrong',
      localPort: fx.upstreamPort,
      relayToken: TOKEN,
      createSocket: (url) => new WebSocket(url.replace(/^wss:/, 'ws:')),
    });
    fx.clients.push(client);
    const closed = new Promise<{ rejected: boolean; code: number; wasConnected: boolean }>((resolve) =>
      client.once('closed', resolve)
    );
    client.start();
    const info = await closed;
    expect(info.rejected).toBe(true);
    expect(info.code).toBe(CLOSE_CODE.REJECTED);
    expect(info.wasConnected).toBe(false);
    expect(fx.relay.tunnelCount).toBe(0);
  });

  it('treats a credential-service outage as transient, not as a rejection', async () => {
    fx.setVerdict('unavailable');
    await expect(fx.connect()).rejects.toThrow(/1013/);
  });

  it('lets a new connection take over a tunnel and tells the old one it was replaced', async () => {
    const first = await fx.connect();
    const replaced = new Promise<boolean>((resolve) => first.once('closed', (info) => resolve(info.replaced)));
    await fx.connect();
    expect(await replaced).toBe(true);
    expect(fx.relay.tunnelCount).toBe(1);
    expect((await visit('/')).status).toBe(200);
  });

  it('cuts a tunnel off within one re-verification interval after revocation', async () => {
    const client = await fx.connect();
    const closed = new Promise<boolean>((resolve) => client.once('closed', (info) => resolve(info.rejected)));
    fx.setVerdict('rejected');
    expect(await closed).toBe(true);
    expect((await visit('/')).body.toString()).toBe('<h1>offline</h1>');
  });

  it('does not kick connected tunnels when the credential service is merely down', async () => {
    const client = await fx.connect();
    fx.setVerdict('unavailable');
    await new Promise((r) => setTimeout(r, 700));
    expect(client.isConnected).toBe(true);
    expect((await visit('/')).status).toBe(200);
  });

  it('goes offline for visitors as soon as the desktop disconnects', async () => {
    const client = await fx.connect();
    client.stop();
    await vi_waitFor(() => fx.relay.tunnelCount === 0);
    expect((await visit('/')).body.toString()).toBe('<h1>offline</h1>');
  });

  it('closes a control connection that never says hello', async () => {
    const relay = new RelayServer({ subdomainHost: HOST, verify: async () => 'ok', helloTimeoutMs: 150 });
    await relay.listen({ host: '127.0.0.1', port: 0 }, { host: '127.0.0.1', port: 0 });
    const ws = new WebSocket(`ws://127.0.0.1:${relay.ports.control}${TUNNEL_PATH}`);
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    expect(code).toBe(CLOSE_CODE.PROTOCOL);
    await relay.close();
  });

  it('client gives up on a relay that never answers the handshake', async () => {
    const dead = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => dead.once('listening', r));
    const client = new TunnelClient({
      serverAddr: '127.0.0.1',
      serverPort: (dead.address() as net.AddressInfo).port,
      subdomain: SUB,
      secret: SECRET,
      localPort: 1,
      relayToken: TOKEN,
      createSocket: (url) => new WebSocket(url.replace(/^wss:/, 'ws:')),
      handshakeTimeoutMs: 150,
    });
    const closed = new Promise<TunnelCloseInfo>((resolve) => client.once('closed', resolve));
    client.start();
    const info = await closed;
    expect(info).toMatchObject({ code: CLOSE_CODE.UNAVAILABLE, wasConnected: false, rejected: false });
    dead.close();
  });

  it('client notices a connection that went silent after the handshake', async () => {
    const quiet = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    quiet.on('connection', (ws) => {
      ws.once('message', () => ws.send(encodeFrame(FRAME.WELCOME, 0, { v: PROTOCOL_VERSION, maxStreams: 8 })));
    });
    await new Promise((r) => quiet.once('listening', r));
    const client = new TunnelClient({
      serverAddr: '127.0.0.1',
      serverPort: (quiet.address() as net.AddressInfo).port,
      subdomain: SUB,
      secret: SECRET,
      localPort: 1,
      relayToken: TOKEN,
      createSocket: (url) => new WebSocket(url.replace(/^wss:/, 'ws:')),
      idleTimeoutMs: 200,
    });
    const closed = new Promise<TunnelCloseInfo>((resolve) => client.once('closed', resolve));
    client.start();
    const info = await closed;
    expect(info).toMatchObject({ wasConnected: true, reason: 'idle timeout' });
    quiet.close();
  });

  it('relay drops a tunnel whose desktop stopped answering pings', async () => {
    const relay = new RelayServer({
      subdomainHost: HOST,
      verify: async () => 'ok',
      pingIntervalMs: 50,
      deadAfterMs: 150,
    });
    await relay.listen({ host: '127.0.0.1', port: 0 }, { host: '127.0.0.1', port: 0 });
    // A raw socket that says hello but never answers pings (autoPong off).
    const ws = new WebSocket(`ws://127.0.0.1:${relay.ports.control}${TUNNEL_PATH}`, { autoPong: false } as never);
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    ws.send(encodeFrame(FRAME.HELLO, 0, { v: PROTOCOL_VERSION, subdomain: SUB, secret: SECRET }));
    await vi_waitFor(() => relay.tunnelCount === 1);
    await vi_waitFor(() => relay.tunnelCount === 0, 2000);
    ws.terminate();
    await relay.close();
  });

  it('ignores control connections on other paths', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${fx.relay.ports.control}/other`);
    await new Promise<void>((resolve) => {
      ws.on('error', () => resolve());
      ws.on('close', () => resolve());
    });
  });
});

async function vi_waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}
