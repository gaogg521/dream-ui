/**
 * WebUI static server.
 *
 * Serves out/renderer/ as the SPA and reverse-proxies /api/*, /ws, /api/stt/stream,
 * /login and /logout to aioncore. All auth goes to backend's dream-auth crate;
 * /login and /logout are dream-auth's top-level paths, the rest live under
 * /api/auth/*. /ws and /api/stt/stream are WebSocket/stream upgrades spliced at
 * TCP level; /api/stt/stream is the STT streaming endpoint.
 *
 * Design: Node native http + serve-handler. No Express. No business routes.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';

export type StaticServerOptions = {
  staticDir: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
  /**
   * Dev-only origin of the renderer dev server (e.g. `http://localhost:5173`).
   * When set, renderer requests are reverse-proxied there instead of being read
   * from `staticDir`.
   *
   * Why this exists: `electron-vite dev` rebuilds only `out/main` and
   * `out/preload` — the renderer is served by its own dev server and
   * `out/renderer` is left at whatever the last full build produced. Since the
   * desktop app points its embedded WebUI at `out/renderer`, the WebUI silently
   * served a stale renderer in dev (measured: hours out of date, and missing
   * entirely in a fresh worktree) while the desktop window showed current code.
   * The app prints that WebUI URL in its own UI, so "it works on the desktop but
   * the web page is still old" was a structural trap, not a mistake.
   */
  rendererDevServerUrl?: string;
  /**
   * Extra request handlers, tried before static serving and after the `/api/*`
   * proxy. Returning true means the handler answered the request.
   *
   * A generic hook rather than a route: this module's contract is "static files
   * + reverse proxy, no business routes", and the desktop shell needs to serve
   * generated media to browser clients under a policy (a real-path fence over
   * the media job store) that only it can evaluate. The mechanism lives here,
   * the policy stays with its data.
   */
  extraHandlers?: Array<(req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean>;
  /**
   * URL prefixes served by `extraHandlers` that require a logged-in session.
   *
   * Declared by the host rather than inferred here, because this module does not
   * know what any of those routes mean — and because the alternative is worse in
   * a way that was measured: gating on "this server *has* extraHandlers" instead
   * of "this *request* is for one" 401'd `/`, `/index.html` and `/assets/*` too,
   * which is where the login UI lives. That locks everyone out permanently:
   * you cannot log in, because you cannot load the page that logs you in.
   *
   * Empty/omitted means no host handler is gated.
   */
  sessionGuardedPrefixes?: string[];
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 25808;

// Ranges that are non-internal IPv4 yet never a reachable LAN address, so we
// must never advertise them as the WebUI access URL even when they are the only
// non-loopback interface present:
//   169.254.0.0/16  link-local / APIPA (host got no DHCP lease)
//   198.18.0.0/15   RFC 2544 benchmarking range — handed out by utility tunnels
//                   such as Cloudflare WARP; this is the address that showed up
//                   on a multi-NIC machine instead of the real LAN IP.
const isUnreachableLanRange = (addr: string): boolean => addr.startsWith('169.254.') || /^198\.(18|19)\./.test(addr);

// Rank candidate LAN addresses by how likely they are the network the user
// actually reaches the desktop on. Lower is better. Private (RFC 1918) home /
// office ranges win over anything else; 192.168/16 is the most common LAN, then
// the 172.16/12 block, then 10/8 (frequently carved up by VPNs / corp routing).
const rankLanCandidate = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 1;
  if (addr.startsWith('10.')) return 2;
  return 3;
};

// Adapter names created by hypervisors, VPNs, and container runtimes rather
// than a physical NIC. These show up as a normal non-internal IPv4 interface
// (e.g. VMware's host-only 192.168.x.x network) that ranks identically to a
// real LAN, so among equally-ranked addresses we prefer whichever one doesn't
// look like a virtual adapter.
const VIRTUAL_ADAPTER_NAME_PATTERN =
  /vmware|virtualbox|vbox|hyper-v|v[ -]?ethernet|virtual|loopback|tap-windows|tailscale|zerotier|docker|wsl|npcap|ppp|bluetooth/i;

// Pick the best LAN IPv4 to advertise. Pure over the interface map so it can be
// unit-tested against real multi-NIC layouts. Iterating and returning the first
// non-internal hit (the old behavior) picks whatever the OS lists first, which
// on a multi-NIC box can be a VPN / benchmark adapter rather than the LAN.
export function pickLanIP(nets: ReturnType<typeof networkInterfaces>): string | null {
  const candidates: { address: string; physical: boolean }[] = [];
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (isUnreachableLanRange(iface.address)) continue;
      candidates.push({ address: iface.address, physical: !VIRTUAL_ADAPTER_NAME_PATTERN.test(name) });
    }
  }
  // Stable sort keeps OS interface order among equally-ranked, equally-physical
  // addresses (e.g. a physical NIC listed before a VPN when both are 10/8).
  candidates.sort((a, b) => {
    const rankDiff = rankLanCandidate(a.address) - rankLanCandidate(b.address);
    if (rankDiff !== 0) return rankDiff;
    return Number(b.physical) - Number(a.physical);
  });
  return candidates[0]?.address ?? null;
}

export function getLanIP(): string | null {
  return pickLanIP(networkInterfaces());
}

/**
 * Marks every request that reached the backend through this proxy.
 *
 * The desktop starts its co-located backend with `--local`, which makes the
 * backend treat a request with no session as "the operator at the keyboard"
 * and hand it `system_default_user` — including its admin role. That is right
 * for the desktop renderer, which talks to the backend port directly. It is
 * badly wrong for this proxy: with `allowRemote` on, our listener is bound to
 * `0.0.0.0`, so the same fallback answered anyone on the network with no
 * credential at all.
 *
 * The backend cannot work this out for itself — we splice over loopback, so
 * every peer looks local by the time it gets there. We are the last layer that
 * knows, so we say so, and the backend requires a real session for anything
 * carrying this header.
 *
 * Set (not appended) so a client-supplied copy is overwritten: the header can
 * only ever make the backend stricter, and a remote caller must not be able to
 * strip it by sending their own.
 */
const WEBUI_PROXY_HEADER = 'x-dream-forwarded-origin';
const WEBUI_PROXY_VALUE = 'webui';

/**
 * Real remote-peer IP of the TCP connection that reached this proxy.
 *
 * Forwarded so the backend can enforce per-project-group IP allowlisting.
 * Necessary for the same structural reason [[WEBUI_PROXY_HEADER]] exists:
 * every non-upgrade request is relayed to the backend (directly, or via this
 * process's own internal HTTP server — see {@link spliceToTcpEndpoint}) over
 * a loopback connection, so by the time anyone downstream inspects the
 * socket peer, it is always 127.0.0.1 regardless of who actually connected.
 * We capture the real peer at TCP-accept time, before any splicing, and
 * carry it forward as a header.
 *
 * Same trust model as `WEBUI_PROXY_HEADER`: set (not appended), so a
 * client-supplied copy is always overwritten — this can only make the
 * backend's check stricter, never let a remote caller claim a different IP.
 */
const CLIENT_IP_HEADER = 'x-dream-client-ip';

/** Strips the IPv4-mapped-IPv6 prefix Node sometimes reports (`::ffff:1.2.3.4` → `1.2.3.4`). */
function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return ip;
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Ask the backend whether this request carries a usable session.
 *
 * Deliberately not a local JWT check: the backend owns signing keys, blacklists
 * and expiry, and a second implementation here would drift from it silently.
 * `/api/auth/user` already answers exactly this question, and — because we send
 * the proxy header — it answers it under the strict rules, so an unauthenticated
 * caller gets 401 rather than the operator fallback.
 */
const SESSION_PROBE_TTL_MS = 5_000;
const sessionProbeCache = new Map<string, { at: number; ok: boolean }>();

async function hasBackendSession(req: IncomingMessage, backendPort: number): Promise<boolean> {
  const cookie = typeof req.headers.cookie === 'string' ? req.headers.cookie : '';
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';

  // Rendering one page of results fires a media request per asset, and
  // `/api/auth/user` sits behind the API rate limiter. Probing per request
  // burned the caller's own budget and came back 429 — which, failing closed,
  // turned into "401, your images are gone" for a user who was properly logged
  // in. Cache the verdict briefly so a burst costs one probe.
  //
  // The TTL bounds how long a revoked session keeps working (seconds), and
  // caching the negative verdict too is what stops an unauthenticated flood
  // from hammering the backend.
  const cacheKey = `${cookie} ${authorization}`;
  const cached = sessionProbeCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < SESSION_PROBE_TTL_MS) return cached.ok;
  if (sessionProbeCache.size > 256) sessionProbeCache.clear();

  const headers: Record<string, string> = { host: `127.0.0.1:${backendPort}`, [WEBUI_PROXY_HEADER]: WEBUI_PROXY_VALUE };
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;

  const ok = await new Promise<boolean>((resolve) => {
    const probe = http.request(
      { hostname: '127.0.0.1', port: backendPort, path: '/api/auth/user', method: 'GET', headers },
      (probeRes) => {
        probeRes.resume();
        resolve(probeRes.statusCode === 200);
      }
    );
    // Fail closed: if we cannot establish that the caller is authenticated, we
    // must not run a handler that spends money on their behalf.
    probe.on('error', () => resolve(false));
    probe.end();
  });

  sessionProbeCache.set(cacheKey, { at: now, ok });
  return ok;
}

function forwardToBackend(req: IncomingMessage, res: ServerResponse, backendPort: number, clientIp?: string): void {
  const headers: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: `127.0.0.1:${backendPort}`,
    [WEBUI_PROXY_HEADER]: WEBUI_PROXY_VALUE,
  };
  if (clientIp) headers[CLIENT_IP_HEADER] = clientIp;
  const options: http.RequestOptions = {
    hostname: '127.0.0.1',
    port: backendPort,
    path: req.url,
    method: req.method,
    headers,
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BACKEND_UNREACHABLE' }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

/**
 * Reverse-proxy a renderer request to the dev server. Separate from
 * {@link forwardToBackend} because the target is an arbitrary origin (host +
 * port, possibly a non-loopback hostname) rather than a known loopback port.
 *
 * On failure this returns a readable 502 naming the dev server instead of
 * falling back to `staticDir` — a silent fallback to a stale bundle is the
 * exact failure mode this option exists to remove.
 */
function forwardToRendererDevServer(req: IncomingMessage, res: ServerResponse, origin: URL): void {
  const proxy = http.request(
    {
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port || (origin.protocol === 'https:' ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: origin.host },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'RENDERER_DEV_SERVER_UNREACHABLE', devServer: origin.origin }));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

// Max bytes we peek before forcing a routing decision. An HTTP request-line
// on its own is typically < 100 bytes; a full header block is < 2 KB. If we
// haven't seen a newline after 4 KB the client is sending something weird —
// hand it to the internal HTTP server and let it return 400.
const PEEK_LIMIT_BYTES = 4096;

/**
 * Splice an upgrade request to the backend, allowing exactly one HTTP request
 * on the connection.
 *
 * Why this is not just {@link spliceToTcpEndpoint} with a stamped head: the
 * stamp is applied once, to a byte buffer, while the backend decides per
 * request. On a keep-alive connection that gap is a hole, and it was
 * demonstrated — two requests written in a single packet:
 *
 *     GET /ws HTTP/1.1\r\nHost: h\r\n\r\nGET /api/providers HTTP/1.1\r\nHost: h\r\n\r\n
 *
 * `/ws` matched the upgrade route and got stamped (400, connection stays open),
 * then `/api/providers` reached the backend **unstamped**, took the local-mode
 * operator fallback, and returned the provider list including plaintext API
 * keys — to an anonymous caller on the LAN.
 *
 * A real upgrade has no body, no pipelining, and sends nothing before the 101.
 * So: refuse a head with anything after it, refuse client bytes until the
 * upstream has actually upgraded, and tear the connection down when it hasn't.
 * After 101 the bytes are WebSocket frames, not requests, and relaying is safe.
 */
function spliceUpgradeToBackend(client: Socket, backendPort: number, head: Buffer, clientIp?: string): void {
  const headEnd = head.indexOf('\r\n\r\n');
  // Anything past the first header block is a second request smuggled in behind
  // the one we routed on.
  if (headEnd < 0 || headEnd + 4 !== head.length) {
    client.destroy();
    return;
  }

  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  const upstream = net.connect({ host: '127.0.0.1', port: backendPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);

  let upgraded = false;
  const tearDown = (): void => {
    client.destroy();
    upstream.destroy();
  };

  upstream.once('connect', () => {
    upstream.write(stampProxyOrigin(head, clientIp));
    upstream.on('data', (chunk: Buffer) => {
      if (!upgraded) {
        upgraded = /^HTTP\/1\.[01] 101/.test(chunk.subarray(0, 16).toString('latin1'));
        client.write(chunk);
        // Not an upgrade: relay the rejection, then close so the socket cannot
        // carry a follow-up request.
        if (!upgraded) {
          client.end();
          upstream.end();
        }
        return;
      }
      client.write(chunk);
    });
    client.on('data', (chunk: Buffer) => {
      // A client that talks before the handshake completes is not doing a
      // WebSocket handshake.
      if (!upgraded) {
        tearDown();
        return;
      }
      upstream.write(chunk);
    });
  });

  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Splice `client` to a TCP endpoint on `targetPort`. Any bytes already read
 * from `client` during peek are replayed to the upstream as the first write,
 * so the endpoint sees the full HTTP request as-sent.
 */
function spliceToTcpEndpoint(
  client: Socket,
  targetPort: number,
  initialBytes: Buffer,
  remoteIpByLocalPort?: Map<number, string>,
  clientIp?: string
): void {
  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  // The peek phase left `client` in flowing mode (it had a 'data' listener),
  // but that listener is now removed and the real consumer — `client.pipe(upstream)`
  // — is only wired inside the async 'connect' handler below. Pause here so any
  // body bytes arriving in the gap are buffered by the socket instead of being
  // dropped for lack of a consumer; `pipe()` resumes the socket once connected.
  // Without this, large/buffered uploads (e.g. reverse-proxied POST bodies that
  // span multiple TCP segments) lose their tail bytes and the backend hangs
  // forever waiting for the missing Content-Length (issue #4058).
  client.pause();
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.once('connect', () => {
    // Record the real peer under the loopback connection's own local port so
    // the internal HTTP server — which only ever sees 127.0.0.1 as the peer,
    // since `upstream` is itself a local socket — can recover it per request.
    // See CLIENT_IP_HEADER.
    if (remoteIpByLocalPort && clientIp && typeof upstream.localPort === 'number') {
      remoteIpByLocalPort.set(upstream.localPort, clientIp);
    }
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const tearDown = (): void => {
    if (remoteIpByLocalPort && typeof upstream.localPort === 'number') {
      remoteIpByLocalPort.delete(upstream.localPort);
    }
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Insert the proxy-origin header into an already-serialized request head.
 *
 * The upgrade routes are spliced as raw bytes, so there is no header object to
 * set — we edit the bytes instead. Safe to do blind: routing only fires once
 * {@link peekWsRoute} has found a newline, so a complete request line is always
 * present.
 *
 * Inserted immediately after the request line, which puts it ahead of anything
 * the client sent. `HeaderMap::get` returns the first value, so a client cannot
 * shadow ours by supplying its own.
 */
function stampProxyOrigin(head: Buffer, clientIp?: string): Buffer {
  const newlineIdx = head.indexOf(0x0a); // \n
  if (newlineIdx < 0) return head;
  const insertAt = newlineIdx + 1;
  const stamp = clientIp
    ? `${WEBUI_PROXY_HEADER}: ${WEBUI_PROXY_VALUE}\r\n${CLIENT_IP_HEADER}: ${clientIp}\r\n`
    : `${WEBUI_PROXY_HEADER}: ${WEBUI_PROXY_VALUE}\r\n`;
  return Buffer.concat([head.subarray(0, insertAt), Buffer.from(stamp, 'ascii'), head.subarray(insertAt)]);
}

/**
 * Decide routing from the first chunk of an incoming HTTP connection:
 *  - `true`  → `GET /ws[...] HTTP/1.x` or `GET /api/stt/stream[...] HTTP/1.x` (WebSocket/stream upgrades), splice to backend
 *  - `false` → any other HTTP method / path, hand to internal HTTP server
 *  - `null`  → need more bytes (no CRLF yet)
 *
 * We only check the request-line; `Upgrade: websocket` is not strictly
 * required — the backend will reject a non-upgrade GET on these paths on its own.
 * Keeping the rule simple means we can decide after the first ~50 bytes
 * instead of waiting for the full header block.
 */
function peekWsRoute(buf: Buffer): boolean | null {
  const newlineIdx = buf.indexOf(0x0a); // \n
  if (newlineIdx < 0) return null;
  const firstLine = buf.slice(0, newlineIdx).toString('ascii');
  return /^GET\s+\/(?:ws|api\/stt\/stream)(?:\?[^\s]*)?\s+HTTP\/1\.[01]\r?$/.test(firstLine);
}

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';

  // Parsed once: a malformed value must fail loudly at startup rather than
  // degrade into serving the stale bundle this option exists to bypass.
  let rendererDevServer: URL | undefined;
  if (opts.rendererDevServerUrl) {
    try {
      rendererDevServer = new URL(opts.rendererDevServerUrl);
    } catch {
      throw new Error(`invalid rendererDevServerUrl: ${opts.rendererDevServerUrl}`);
    }
  }

  // The HTTP server listens only on loopback — user traffic hits the outer
  // net.Server first. We route to this server for everything except WS
  // upgrades and STT stream upgrades, which go straight to the backend via a raw TCP splice.
  //
  // Why two listeners instead of using `http.Server`'s native `upgrade` event:
  // bun 1.3's http-compat layer does not faithfully forward writes on the
  // socket delivered to the `upgrade` handler, so the backend's 101 response
  // never reaches the browser (see #2824). Making the outer listener pure
  // TCP avoids touching that code path on both bun and node.
  //
  // Real client IP of the TCP connection, keyed by the loopback local port
  // `spliceToTcpEndpoint` used to reach this internal server — see
  // CLIENT_IP_HEADER for why the socket peer itself can't answer this here.
  const remoteIpByLocalPort = new Map<number, string>();

  const http_server: Server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        res.writeHead(400).end();
        return;
      }

      const clientIp = normalizeIp(remoteIpByLocalPort.get(req.socket.remotePort ?? -1));

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are dream-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      // /health was missing from this allowlist entirely: it fell through to the
      // SPA fallback below, which answers any unmatched path with `index.html`
      // (200, no CORS headers). That accidentally "looked" reachable to a
      // same-origin caller, but a cross-origin `fetch()` — exactly what the
      // desktop client's "connect to remote enterprise server" probe does —
      // gets blocked by the browser's CORS policy before it can even read the
      // status code, so the probe always reported the server unreachable. The
      // real `/health` route (in dream-app's router) already sends CORS
      // headers like every other `/api/*` response; it just never got a chance
      // to answer.
      if (
        req.url.startsWith('/api/') ||
        req.url.startsWith('/api?') ||
        req.url === '/login' ||
        req.url === '/logout' ||
        req.url === '/health' ||
        req.url.startsWith('/health?')
      ) {
        forwardToBackend(req, res, opts.backendPort, clientIp);
        return;
      }

      // Host-supplied handlers (e.g. the desktop shell's generated-media
      // route). After the proxy so they can never shadow a backend path.
      //
      // These do NOT go through the backend, so the auth the backend applies to
      // `/api/*` does not cover them — and they are not read-only: starting a
      // generation spends money. Gate them on the same session the backend
      // would demand, by asking the backend rather than re-deriving "is this
      // token valid" here. One source of truth; the proxy only relays the
      // question.
      if (opts.extraHandlers?.length) {
        const pathname = req.url.split('?', 1)[0] ?? '';
        const guarded = (opts.sessionGuardedPrefixes ?? []).some((prefix) => pathname.startsWith(prefix));
        if (guarded && !(await hasBackendSession(req, opts.backendPort))) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
          return;
        }
        let answered = false;
        for (const handler of opts.extraHandlers) {
          if (await handler(req, res)) {
            answered = true;
            break;
          }
        }
        if (answered) return;
      }

      // Renderer: dev server when one is configured, else static files + SPA
      // fallback. HMR's own WebSocket is not routed here (the TCP layer below
      // only splices backend upgrades), so a dev WebUI tab picks up changes on
      // reload rather than live — still current, just not hot.
      if (rendererDevServer) {
        forwardToRendererDevServer(req, res, rendererDevServer);
        return;
      }
      await serveHandler(req, res, {
        public: opts.staticDir,
        rewrites: [{ source: '**', destination: '/index.html' }],
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });

  // Internal HTTP server — 127.0.0.1 ephemeral port, never visible to the user.
  await new Promise<void>((resolve, reject) => {
    http_server.once('error', reject);
    http_server.listen(0, '127.0.0.1', () => {
      http_server.off('error', reject);
      resolve();
    });
  });
  const internalPort = (http_server.address() as { port: number } | null)?.port;
  if (!internalPort) {
    throw new Error('internal HTTP server failed to bind to a port');
  }

  // User-facing listener: inspect the first line of every TCP connection and
  // route to either the backend (for /ws and /api/stt/stream upgrades) or the internal HTTP
  // server (everything else). Both routes use raw TCP splice — no reliance
  // on http.Server's upgrade event.
  const tcp_server = net.createServer((client: Socket) => {
    let peeked = Buffer.alloc(0);
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      client.removeListener('data', onData);
      client.removeListener('error', onEarlyError);
      client.removeListener('end', onEarlyEnd);
    };
    const onData = (chunk: Buffer): void => {
      peeked = Buffer.concat([peeked, chunk]);
      const decision = peekWsRoute(peeked);
      if (decision === null && peeked.length < PEEK_LIMIT_BYTES) return;
      // The upgrade routes reach the backend as raw bytes — `forwardToBackend`
      // never runs for them, so they arrive unmarked unless we stamp them, and
      // an unmarked request takes the backend's local-mode operator fallback.
      // `/ws` validates its own token, but `/api/stt/stream` relies entirely on
      // the auth middleware.
      //
      // Wait for the whole header block before handing off: the routing verdict
      // only needs the first line, but `spliceUpgradeToBackend` has to see where
      // the request ends to tell "one upgrade" from "an upgrade with another
      // request pipelined behind it". Bounded by the same peek limit.
      if (decision === true && peeked.indexOf('\r\n\r\n') < 0 && peeked.length < PEEK_LIMIT_BYTES) return;
      cleanup();
      const clientIp = normalizeIp(client.remoteAddress);
      if (decision === true) {
        spliceUpgradeToBackend(client, opts.backendPort, peeked, clientIp);
        return;
      }
      spliceToTcpEndpoint(client, internalPort, peeked, remoteIpByLocalPort, clientIp);
    };
    const onEarlyError = (): void => {
      cleanup();
      client.destroy();
    };
    const onEarlyEnd = (): void => {
      // Client closed before we saw a request line — nothing to route.
      cleanup();
      client.destroy();
    };
    client.on('data', onData);
    client.on('error', onEarlyError);
    client.on('end', onEarlyEnd);
  });

  await new Promise<void>((resolve, reject) => {
    tcp_server.once('error', reject);
    tcp_server.listen(port, host, () => {
      tcp_server.off('error', reject);
      resolve();
    });
  });

  const actualPort = (tcp_server.address() as { port: number } | null)?.port ?? port;
  const lanIP = allowRemote ? (getLanIP() ?? undefined) : undefined;
  const localUrl = `http://127.0.0.1:${actualPort}`;
  const networkUrl = lanIP ? `http://${lanIP}:${actualPort}` : undefined;

  return {
    port: actualPort,
    url: networkUrl ?? localUrl,
    localUrl,
    networkUrl,
    lanIP,
    stop: () =>
      new Promise<void>((resolve) => {
        tcp_server.close(() => {
          http_server.close(() => resolve());
        });
      }),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
