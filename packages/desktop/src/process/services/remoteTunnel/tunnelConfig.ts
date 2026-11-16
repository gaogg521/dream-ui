/**
 * Copyright 2026 One Work
 *
 * Pure helpers for the remote-access tunnel: the registration response shape and its
 * persisted form. No Electron, no I/O.
 */

export type TunnelCredentials = {
  subdomain: string;
  secret: string;
  publicUrl: string;
  /** Host the desktop dials over wss (the relay's public name). */
  serverAddr: string;
  serverPort: number;
};

/** Validate the broker's registration response; anything off is refused rather than half-used. */
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
