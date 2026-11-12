/**
 * Who is really on the other end of a request that reached the WebUI.
 *
 * The socket peer is only the real client for direct (LAN) connections. A
 * request relayed by the remote-access tunnel arrives from `frpc` on
 * 127.0.0.1, so every outside visitor would share one address — and with it
 * one login rate-limit bucket: a stranger failing five logins would lock the
 * owner out, and the login page itself with them.
 *
 * The relay's edge (nginx) writes the visitor's address into `X-Real-IP`, but
 * that header is only believable when it provably came through the relay:
 * `X-Real-IP` is client-controlled everywhere else (another tunnel such as a
 * Cloudflare quick tunnel also arrives from loopback and passes it through
 * untouched). So frpc stamps every request with a secret that exists only in
 * this process (`x-onework-relay-token`, overwriting anything the visitor
 * sent), and the address is only taken from `X-Real-IP` when that secret
 * matches.
 */

import { timingSafeEqual } from 'node:crypto';
import net from 'node:net';

export const RELAY_TOKEN_HEADER = 'x-onework-relay-token';

type HeaderBag = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

const isLoopback = (ip: string): boolean => ip === '127.0.0.1' || ip === '::1';

const stripV4Mapped = (ip: string): string => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param peer       socket peer of the connection (already IPv4-normalized)
 * @param headers    request headers, lower-cased names
 * @param relayToken the secret frpc stamps; without one nothing is trusted
 */
export function resolveClientIp(peer: string | undefined, headers: HeaderBag, relayToken?: string): string | undefined {
  if (!relayToken || !peer || !isLoopback(peer)) return peer;
  const presented = first(headers[RELAY_TOKEN_HEADER]);
  if (!presented || !secretsMatch(presented, relayToken)) return peer;
  const claimed = first(headers['x-real-ip'])?.trim();
  if (!claimed) return peer;
  const real = stripV4Mapped(claimed);
  return net.isIP(real) ? real : peer;
}

/**
 * Header bag out of a serialized request head, for the upgrade paths that are
 * spliced as raw bytes and so never see a parsed `IncomingMessage`. First
 * occurrence wins, matching what the backend does with duplicates.
 */
export function headersFromHead(head: Buffer): HeaderBag {
  const text = head.toString('latin1');
  const end = text.indexOf('\r\n\r\n');
  const block = end >= 0 ? text.slice(0, end) : text;
  const out: HeaderBag = {};
  for (const line of block.split('\r\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!(name in out)) out[name] = line.slice(colon + 1).trim();
  }
  return out;
}
