/**
 * Copyright 2026 One Work
 *
 * Pure helpers for the remote-access tunnel: the frpc config, the registration
 * response shape, and a classifier for frpc's log lines. No Electron, no I/O.
 */

export type TunnelCredentials = {
  subdomain: string;
  secret: string;
  publicUrl: string;
  serverAddr: string;
  serverPort: number;
};

/** frps `auth.token`. Ships in the public client, so it authenticates nothing —
 * the per-tunnel secret checked by the broker is the real gate. */
export const FRP_SHARED_TOKEN = 'onework-remote-v1';

/** Header frpc stamps on every relayed request; web-host believes `X-Real-IP` only when it matches. */
export const RELAY_TOKEN_HEADER = 'x-onework-relay-token';

/** Escape for a TOML basic string. Inputs are server-issued but never trusted blindly. */
const tomlString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function parseRegistration(raw: unknown): TunnelCredentials {
  const r = raw as Record<string, unknown> | null;
  const subdomain = typeof r?.subdomain === 'string' ? r.subdomain : '';
  const secret = typeof r?.secret === 'string' ? r.secret : '';
  const publicUrl = typeof r?.public_url === 'string' ? r.public_url : '';
  const serverAddr = typeof r?.server_addr === 'string' ? r.server_addr : '';
  const serverPort = typeof r?.server_port === 'number' ? r.server_port : 0;
  if (!/^[a-z0-9]{6,32}$/.test(subdomain)) throw new Error('registration: bad subdomain');
  if (!secret) throw new Error('registration: missing secret');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(publicUrl)) throw new Error('registration: bad public_url');
  if (!/^[A-Za-z0-9.-]+$/.test(serverAddr)) throw new Error('registration: bad server_addr');
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error('registration: bad server_port');
  }
  return { subdomain, secret, publicUrl, serverAddr, serverPort };
}

export function isTunnelCredentials(value: unknown): value is TunnelCredentials {
  try {
    const v = value as Record<string, unknown>;
    parseRegistration({
      subdomain: v.subdomain,
      secret: v.secret,
      public_url: v.publicUrl,
      server_addr: v.serverAddr,
      server_port: v.serverPort,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * frpc config. Control channel is wss (rides the server's normal 443, so it
 * passes proxies that only allow web traffic); only the local WebUI is
 * published, as a single http proxy on this tunnel's own subdomain.
 */
export function buildFrpcConfig(creds: TunnelCredentials, localPort: number, relayToken: string): string {
  return [
    `serverAddr = ${tomlString(creds.serverAddr)}`,
    `serverPort = ${creds.serverPort}`,
    `user = ${tomlString(creds.subdomain)}`,
    // Keep retrying when the network is down at start instead of exiting.
    'loginFailExit = false',
    `auth.method = "token"`,
    `auth.token = ${tomlString(FRP_SHARED_TOKEN)}`,
    'transport.protocol = "wss"',
    `metadatas.subdomain = ${tomlString(creds.subdomain)}`,
    `metadatas.secret = ${tomlString(creds.secret)}`,
    'log.to = "console"',
    'log.level = "info"',
    '',
    '[[proxies]]',
    'name = "webui"',
    'type = "http"',
    'localIP = "127.0.0.1"',
    `localPort = ${localPort}`,
    `subdomain = ${tomlString(creds.subdomain)}`,
    // `set` overwrites whatever the visitor sent under this name, so only the
    // relay path can ever carry the real token.
    `requestHeaders.set.${tomlString(RELAY_TOKEN_HEADER)} = ${tomlString(relayToken)}`,
    '',
  ].join('\n');
}

export type FrpcEvent = 'connected' | 'disconnected' | 'rejected' | 'none';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** Classify one frpc log line. Colors are stripped first. */
export function classifyFrpcLine(line: string): FrpcEvent {
  const text = line.replace(ANSI, '');
  if (
    /invalid tunnel credentials|proxy subdomain does not match|user must equal subdomain|tunnel disabled/.test(text)
  ) {
    return 'rejected';
  }
  if (/\[webui\] start proxy success/.test(text)) return 'connected';
  if (
    /connect to server error|login to the server failed|control (?:connection )?closed|reconnect to server/i.test(text)
  ) {
    return 'disconnected';
  }
  return 'none';
}

/** Restart delays after an unexpected frpc exit: 2s, 5s, 15s, then 30s. */
export function restartDelayMs(attempt: number): number {
  const steps = [2000, 5000, 15000, 30000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)];
}
