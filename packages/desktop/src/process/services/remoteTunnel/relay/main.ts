/**
 * Copyright 2026 One Work
 *
 * Entry point of the relay service (bundled to one file by scripts/buildTunnelRelay.mjs and
 * run by systemd on the public server). Configuration is environment only:
 *
 *   RELAY_SUBDOMAIN_HOST   parent host of tunnel subdomains            (default r.1work.vip)
 *   RELAY_BROKER_URL       credential authority, loopback              (default http://127.0.0.1:8787)
 *   RELAY_BIND             address both listeners bind to              (default 127.0.0.1)
 *   RELAY_CONTROL_PORT     desktops connect here (via nginx wss)       (default 7000)
 *   RELAY_VISITOR_PORT     visitor HTTP, fronted by nginx              (default 7080)
 *   RELAY_OFFLINE_PAGE     HTML file shown when a desktop is offline   (optional)
 */

import { readFileSync } from 'node:fs';
import { RelayServer, type VerifyResult } from './server';

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;

const brokerUrl = env('RELAY_BROKER_URL', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const bind = env('RELAY_BIND', '127.0.0.1');
const log = (message: string): void => console.log(`${new Date().toISOString()} ${message}`);

async function verify(
  subdomain: string,
  secret: string,
  kind: 'login' | 'recheck',
  connectionId?: string
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${brokerUrl}/internal/tunnel/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subdomain,
        secret,
        login: kind === 'login',
        relay_connection:
          process.env.RELAY_NODE_ID && connectionId ? `${process.env.RELAY_NODE_ID}:${connectionId}` : undefined,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'unavailable';
    const body = (await res.json()) as { ok?: unknown; replaced?: unknown };
    if (body.replaced === true) return 'replaced';
    return body.ok === true ? 'ok' : 'rejected';
  } catch (error) {
    log(`broker verify failed: ${String(error)}`);
    return 'unavailable';
  }
}

let offlinePage: string | undefined;
const offlinePath = process.env.RELAY_OFFLINE_PAGE?.trim();
if (offlinePath) {
  try {
    offlinePage = readFileSync(offlinePath, 'utf-8');
  } catch (error) {
    log(`cannot read offline page ${offlinePath}: ${String(error)}`);
  }
}

const peerUrl = process.env.RELAY_PEER_URL?.trim();
const peerToken = process.env.RELAY_PEER_TOKEN?.trim();
if (peerUrl && (!peerToken || peerToken.length < 32 || new URL(peerUrl).hostname !== '127.0.0.1')) {
  throw new Error('Relay peer requires a loopback URL and a private token of at least 32 characters');
}

const relay = new RelayServer({
  subdomainHost: env('RELAY_SUBDOMAIN_HOST', 'r.1work.vip'),
  verify,
  offlinePage,
  log,
  peer: peerUrl && peerToken ? { url: peerUrl, token: peerToken } : undefined,
  reverifyIntervalMs: process.env.RELAY_NODE_ID ? 10_000 : undefined,
});

async function main(): Promise<void> {
  await relay.listen(
    { host: bind, port: Number(env('RELAY_CONTROL_PORT', '7000')) },
    { host: bind, port: Number(env('RELAY_VISITOR_PORT', '7080')) }
  );
  log(
    `relay listening on ${bind} control=${env('RELAY_CONTROL_PORT', '7000')} visitor=${env('RELAY_VISITOR_PORT', '7080')}`
  );

  const shutdown = (): void => {
    void relay.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  log(`fatal: ${String(error)}`);
  process.exit(1);
});
