import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from './static-server.js';

async function mkRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-static-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
  await fs.mkdir(path.join(dir, 'assets'));
  await fs.writeFile(path.join(dir, 'assets', 'main.js'), 'console.log("hi")');
  return dir;
}

async function startMockBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('static-server', () => {
  let handle: StaticServerHandle | null = null;
  let stopBackend: (() => Promise<void>) | null = null;
  let staticDir = '';

  beforeEach(async () => {
    staticDir = await mkRendererFixture();
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (stopBackend) {
      await stopBackend();
      stopBackend = null;
    }
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  describe('rendererDevServerUrl (dev)', () => {
    // Regression guard: `electron-vite dev` never rewrites out/renderer, so the
    // embedded WebUI used to serve a bundle hours older than the desktop window
    // — or 404 in a worktree that had never built. These pin the proxy that
    // replaces that behaviour, and pin that it never silently falls back to the
    // stale directory.
    it('proxies renderer requests to the dev server instead of staticDir', async () => {
      const backend = await startMockBackend((_req, res) => res.end('nope'));
      stopBackend = backend.close;
      const dev = await startMockBackend((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>from-dev-server</title>');
      });
      try {
        handle = await startStaticServer({
          staticDir,
          backendPort: backend.port,
          port: 0,
          rendererDevServerUrl: `http://127.0.0.1:${dev.port}`,
        });
        const r = await fetch(`${handle.localUrl}/`);
        expect(r.status).toBe(200);
        const text = await r.text();
        expect(text).toContain('from-dev-server');
        // The on-disk fixture must NOT win — that is the stale-bundle bug.
        expect(text).not.toContain('<title>root</title>');
      } finally {
        await dev.close();
      }
    });

    it('still proxies /api/* to the backend, not the dev server', async () => {
      const backend = await startMockBackend((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ from: 'backend' }));
      });
      stopBackend = backend.close;
      const dev = await startMockBackend((_req, res) => res.end('from-dev-server'));
      try {
        handle = await startStaticServer({
          staticDir,
          backendPort: backend.port,
          port: 0,
          rendererDevServerUrl: `http://127.0.0.1:${dev.port}`,
        });
        const r = await fetch(`${handle.localUrl}/api/ping`);
        expect(await r.json()).toEqual({ from: 'backend' });
      } finally {
        await dev.close();
      }
    });

    it('returns 502 naming the dev server rather than falling back to the stale bundle', async () => {
      const backend = await startMockBackend((_req, res) => res.end('nope'));
      stopBackend = backend.close;
      // Bind then immediately release, so the port is almost certainly dead.
      const dead = await startMockBackend((_req, res) => res.end('x'));
      const deadPort = dead.port;
      await dead.close();
      handle = await startStaticServer({
        staticDir,
        backendPort: backend.port,
        port: 0,
        rendererDevServerUrl: `http://127.0.0.1:${deadPort}`,
      });
      const r = await fetch(`${handle.localUrl}/`);
      expect(r.status).toBe(502);
      expect((await r.json()).error).toBe('RENDERER_DEV_SERVER_UNREACHABLE');
    });

    it('rejects a malformed dev-server URL at startup', async () => {
      const backend = await startMockBackend((_req, res) => res.end('nope'));
      stopBackend = backend.close;
      await expect(
        startStaticServer({ staticDir, backendPort: backend.port, port: 0, rendererDevServerUrl: 'not-a-url' })
      ).rejects.toThrow(/invalid rendererDevServerUrl/);
    });
  });

  it('serves static index.html at /', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('<title>root</title>');
  });

  it('SPA fallback: /chat/123 returns index.html', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/chat/123`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>root</title>');
  });

  it('static asset /assets/main.js served', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/assets/main.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('hi');
  });

  it('/api/* reverse-proxies to backend', async () => {
    const backend = await startMockBackend((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { path: string };
    expect(json.path).toBe('/api/anything');
  });

  // The backend runs with `--local`, which makes a session-less request resolve
  // to the operator (admin). That is right for the desktop, which talks to the
  // backend directly — and wrong here, because with allowRemote this listener is
  // on 0.0.0.0. The header is how the backend tells the two apart.
  it('stamps the proxy-origin header on every backend request', async () => {
    let seen: string | undefined;
    const backend = await startMockBackend((req, res) => {
      seen = req.headers['x-aionui-forwarded-origin'] as string | undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    await fetch(`${handle.localUrl}/api/anything`);
    expect(seen).toBe('webui');
  });

  // A remote caller must not be able to opt out of the stricter rules by
  // sending the header themselves — we overwrite rather than append.
  it('overwrites a client-supplied proxy-origin header', async () => {
    let seen: string | string[] | undefined;
    const backend = await startMockBackend((req, res) => {
      seen = req.headers['x-aionui-forwarded-origin'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    await fetch(`${handle.localUrl}/api/anything`, { headers: { 'x-aionui-forwarded-origin': 'not-webui' } });
    expect(seen).toBe('webui');
  });

  // IP-allowlist enforcement lives on the backend, but it can only see the
  // real caller if this proxy tells it — every non-upgrade request is
  // relayed over a loopback splice, so the backend's own socket peer is
  // always 127.0.0.1 regardless of who actually connected.
  it('forwards the real client IP on /api/* requests', async () => {
    let seen: string | undefined;
    const backend = await startMockBackend((req, res) => {
      seen = req.headers['x-aionui-client-ip'] as string | undefined;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    await fetch(`${handle.localUrl}/api/anything`);
    // The test client itself connects over loopback, so the "real" peer is
    // 127.0.0.1 — what matters is that it is present and normalized (no
    // ::ffff: prefix), not that it differs from localhost in this test.
    expect(seen).toBe('127.0.0.1');
  });

  // Same spoofing protection as the proxy-origin header: a remote caller
  // must not be able to lie about their own IP to slip past an allowlist.
  it('overwrites a client-supplied client-ip header', async () => {
    let seen: string | string[] | undefined;
    const backend = await startMockBackend((req, res) => {
      seen = req.headers['x-aionui-client-ip'];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    await fetch(`${handle.localUrl}/api/anything`, { headers: { 'x-aionui-client-ip': '1.2.3.4' } });
    expect(seen).toBe('127.0.0.1');
  });

  // Every request on a keep-alive connection must carry the real IP, not
  // just the first one — the port-correlation map (not a per-connection byte
  // stamp) is what makes that true for this code path.
  it('forwards the real client IP on every request of a keep-alive connection', async () => {
    const seen: (string | undefined)[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.headers['x-aionui-client-ip'] as string | undefined);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      await new Promise<void>((resolve, reject) => {
        http.get(`${handle!.localUrl}/api/one`, { agent }, (res) => {
          res.resume();
          res.on('end', resolve);
          res.on('error', reject);
        });
      });
      await new Promise<void>((resolve, reject) => {
        http.get(`${handle!.localUrl}/api/two`, { agent }, (res) => {
          res.resume();
          res.on('end', resolve);
          res.on('error', reject);
        });
      });
    } finally {
      agent.destroy();
    }
    expect(seen).toEqual(['127.0.0.1', '127.0.0.1']);
  });

  // `/media/*` is served by the desktop shell, not the backend, so the backend's
  // auth never sees it — and starting a generation through it spends money.
  it('refuses host handlers when the backend says there is no session', async () => {
    let handlerRan = false;
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      sessionGuardedPrefixes: ['/media/'],
      extraHandlers: [
        (_req, res) => {
          handlerRan = true;
          res.writeHead(200).end('served');
          return true;
        },
      ],
    });
    const r = await fetch(`${handle.localUrl}/media/file?path=x`);
    expect(r.status).toBe(401);
    expect(handlerRan).toBe(false);
  });

  it('runs host handlers when the backend accepts the session', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      sessionGuardedPrefixes: ['/media/'],
      extraHandlers: [
        (_req, res) => {
          res.writeHead(200).end('served');
          return true;
        },
      ],
    });
    const r = await fetch(`${handle.localUrl}/media/file?path=x`, { headers: { cookie: 'dream-session=t' } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('served');
  });

  // `/ws` and `/api/stt/stream` are spliced to the backend as raw bytes, so
  // `forwardToBackend` never runs for them — they need the header stamped into
  // the request head itself. Tested separately because it is a different code
  // path, not a different route on the same one.
  it('stamps the proxy-origin header on spliced upgrade requests', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend(() => {});
    stopBackend = backend.close;
    // The mock's plain handler never sees an upgrade, so read the raw head.
    const raw = net.createServer((sock) => {
      sock.once('data', (chunk: Buffer) => {
        seen.push(chunk.toString('ascii'));
        sock.end();
      });
    });
    await new Promise<void>((r) => raw.listen(0, '127.0.0.1', () => r()));
    const rawPort = (raw.address() as AddressInfo).port;

    handle = await startStaticServer({ staticDir, backendPort: rawPort, port: 0 });
    const sock = net.connect({ host: '127.0.0.1', port: handle.port });
    await new Promise<void>((r) => sock.once('connect', () => r()));
    sock.write(['GET /api/stt/stream HTTP/1.1', 'Host: x', '', ''].join('\r\n'));
    await new Promise((r) => setTimeout(r, 500));
    sock.destroy();
    await new Promise<void>((r) => raw.close(() => r()));

    expect(seen.length).toBe(1);
    // Stamped, and ahead of any client-supplied copy (HeaderMap::get wins on first).
    expect(seen[0]).toContain('x-aionui-forwarded-origin: webui');
    expect(seen[0].indexOf('x-aionui-forwarded-origin')).toBeLessThan(seen[0].indexOf('Host:'));
    // The client-IP header must also be stamped on this path — it bypasses
    // forwardToBackend entirely (raw byte splice), so it needs its own stamp.
    expect(seen[0]).toContain('x-aionui-client-ip: 127.0.0.1');
  });

  // Rendering a page of results fires one media request per asset, and
  // `/api/auth/user` is rate-limited. Probing per request burned the caller's
  // own budget, came back 429, and — failing closed — showed a properly
  // logged-in user "401, images gone". Real regression, caught on the machine.
  it('probes the backend once for a burst of host-handler requests', async () => {
    let probes = 0;
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user') {
        probes += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      sessionGuardedPrefixes: ['/media/'],
      extraHandlers: [
        (_req, res) => {
          res.writeHead(200).end('served');
          return true;
        },
      ],
    });
    const burst = await Promise.all(
      Array.from({ length: 8 }, (_v, i) =>
        fetch(`${handle!.localUrl}/media/file?path=${i}`, { headers: { cookie: 'dream-session=t' } })
      )
    );
    expect(burst.every((r) => r.status === 200)).toBe(true);
    expect(probes).toBeLessThanOrEqual(2);
  });

  // Regression: the first version of the session gate keyed off "this server HAS
  // extraHandlers" rather than "this request is FOR one", so it 401'd `/` and
  // `/assets/*` as well. The login UI is in that bundle, so nobody could log in —
  // and nobody could get a session, because getting one required the page the
  // gate was withholding. Caught on the machine, not by the suite.
  it('leaves the renderer reachable without a session when host handlers are gated', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      sessionGuardedPrefixes: ['/media/'],
      extraHandlers: [
        (_req, res) => {
          res.writeHead(200).end('served');
          return true;
        },
      ],
    });

    // Anonymous: the app shell and its assets must still load...
    for (const p of ['/', '/index.html', '/assets/main.js', '/chat/123']) {
      expect((await fetch(`${handle.localUrl}${p}`)).status).toBe(200);
    }
    // ...while the guarded prefix stays shut.
    expect((await fetch(`${handle.localUrl}/media/file?path=x`)).status).toBe(401);
  });

  // Real bypass, demonstrated against the running app before this guard existed:
  // request #1 matches the upgrade route and gets stamped; request #2, pipelined
  // behind it on the same socket, reached the backend UNSTAMPED, took the
  // local-mode operator fallback, and returned provider records with plaintext
  // API keys to an anonymous LAN caller. The stamp was per-connection; the
  // backend decides per-request.
  it('refuses a second request pipelined behind an upgrade', async () => {
    const seen: string[] = [];
    const raw = net.createServer((sock) => {
      sock.on('data', (chunk: Buffer) => {
        seen.push(chunk.toString('latin1'));
        sock.write(['HTTP/1.1 400 Bad Request', 'Content-Length: 0', '', ''].join('\r\n'));
      });
    });
    await new Promise<void>((r) => raw.listen(0, '127.0.0.1', () => r()));
    const rawPort = (raw.address() as AddressInfo).port;

    handle = await startStaticServer({ staticDir, backendPort: rawPort, port: 0 });
    const sock = net.connect({ host: '127.0.0.1', port: handle.port });
    await new Promise<void>((r) => sock.once('connect', () => r()));
    const CRLF = String.fromCharCode(13, 10);
    sock.write(
      ['GET /ws HTTP/1.1', 'Host: h', '', ''].join(CRLF) + ['GET /api/providers HTTP/1.1', 'Host: h', '', ''].join(CRLF)
    );
    await new Promise((r) => setTimeout(r, 600));
    sock.destroy();
    await new Promise<void>((r) => raw.close(() => r()));

    // The smuggled request must never have been forwarded.
    expect(seen.join('')).not.toContain('/api/providers');
  });

  it('/login reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/login' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'dream-session=backend-token; Path=/; HttpOnly',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'anything' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/dream-session=backend-token/);
    const json = (await r.json()) as { proxied: boolean };
    expect(json.proxied).toBe(true);
  });

  it('/api/auth/user reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { username: 'from-backend', id: 'from-backend' } }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/auth/user`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { user: { username: string } };
    expect(json.user.username).toBe('from-backend');
  });

  it('/logout reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/logout' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'dream-session=; Path=/; Max-Age=0',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/logout`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  // Regression guard: /health was missing from the proxy allowlist entirely,
  // so it silently fell through to the SPA fallback (200, index.html, no CORS
  // headers) instead of reaching the backend's real health_check route (which
  // sends CORS headers like every other /api/* response). A same-origin caller
  // couldn't tell the difference — status 200 either way — but the desktop
  // client's "connect to remote enterprise server" feature probes /health with
  // a cross-origin `fetch()`, which the browser silently blocks on a
  // CORS-header-less response. The probe always reported a perfectly healthy
  // remote server as unreachable. Asserting on backend-only content (not just
  // status 200, which the SPA fallback also returns) is what makes this catch
  // a regression to "falls through to SPA fallback" rather than passing either way.
  it('/health reverse-proxies to backend, not the SPA fallback', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', fromBackend: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/health`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { fromBackend?: boolean };
    expect(json.fromBackend).toBe(true);
  });

  it('/api proxy returns 502 when backend unreachable', async () => {
    // allocate a port then free it
    const placeholder = await startMockBackend((_req, res) => res.end());
    const freePort = placeholder.port;
    await placeholder.close();

    handle = await startStaticServer({ staticDir, backendPort: freePort, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(502);
  });

  it('/ws WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Mock backend that accepts any WebSocket upgrade and replies with 101.
    // We don't run a real ws protocol — just verify the upgrade response makes
    // it back through the TCP-splice proxy. This is the exact regression path
    // that bun 1.3's http-compat upgrade handler broke.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      // Send a single 0-length WS text frame as a liveness marker then close.
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    // Speak raw HTTP/1.1 upgrade over a TCP socket against the public listener.
    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /ws HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('/api/stt/stream WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Same as /ws test but for STT streaming endpoint.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /api/stt/stream HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('/api/stt/stream with query params is spliced to backend', async () => {
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /api/stt/stream?lang=en&model=default HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('POST body with a large payload is fully forwarded to backend (no byte drop during splice)', async () => {
    // Regression for #4058: WebUI uploads hang forever at 100%. When the routing
    // decision fired on the first chunk, the pre-router removed its 'data'
    // listener but left the socket in flowing mode; body bytes arriving before
    // the async `client.pipe(upstream)` was wired had no consumer and were
    // silently dropped. The backend then waited forever for the missing bytes,
    // so the browser upload sat at 100% and never returned. A body large enough
    // to span multiple TCP segments reproduces the race deterministically.
    const BODY_LEN = 512 * 1024; // 512 KB — spans several TCP segments

    const backend = await startMockBackend((req, res) => {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received }));
      });
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const { port: publicPort } = handle;
    const body = Buffer.alloc(BODY_LEN, 0x61); // 512 KB of 'a'

    const received: number = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: publicPort,
          method: 'POST',
          path: '/api/fs/upload',
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': BODY_LEN,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            raw += c;
          });
          res.on('end', () => {
            try {
              resolve((JSON.parse(raw) as { received: number }).received);
            } catch (e) {
              reject(e as Error);
            }
          });
        }
      );
      request.on('error', reject);
      request.setTimeout(5000, () => {
        request.destroy(new Error('timeout: backend never received the full body (bytes dropped in splice)'));
      });
      request.end(body);
    });

    expect(received).toBe(BODY_LEN);
  });

  it('network URL populated only when allowRemote=true', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    const h1 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
    });
    expect(h1.networkUrl).toBeUndefined();
    await h1.stop();

    const h2 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
    });
    // may still be undefined on CI machines without a LAN interface
    expect(typeof h2.networkUrl === 'string' || h2.networkUrl === undefined).toBe(true);
    await h2.stop();
  });
});
