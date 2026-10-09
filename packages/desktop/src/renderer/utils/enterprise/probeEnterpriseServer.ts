/**
 * Probing an enterprise server address before the client connects to it.
 *
 * Shared by the settings card and the onboarding wizard so "type an address →
 * connect" behaves the same everywhere. Beyond the reachable / not-enterprise
 * verdict it answers the two mistakes users actually make (2026-10-09 field
 * report): typing a backend-internal port (25808/25809 — the gateway on 80/443
 * is the only published entry), and typing THIS machine's own address, whose
 * personal-edition backend answers /health fine and then 404s the enterprise
 * API, which used to read as "the server has no enterprise module".
 */

export type EnterpriseProbeResult = 'ok' | 'unreachable' | 'no-enterprise';

export async function probeRemoteEnterpriseServer(baseUrl: string): Promise<EnterpriseProbeResult> {
  try {
    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
    if (!health.ok) return 'unreachable';
    const org = await fetch(`${baseUrl}/api/one/org/public-info`, { signal: AbortSignal.timeout(8000) });
    if (org.status === 404) return 'no-enterprise';
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

export type LocalClientInfo = {
  /** This machine's LAN address, when known (WebUI status). */
  lanIP?: string | null;
  /** Ports this client itself listens on (embedded backend, WebUI). */
  ports: ReadonlyArray<number | null | undefined>;
};

/** True when `origin` points back at this desktop client's own backend. */
export function isOwnClientAddress(origin: string, local: LocalClientInfo): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const isThisMachine = LOOPBACK_HOSTS.has(host) || (Boolean(local.lanIP) && host === local.lanIP);
  if (!isThisMachine) return false;
  const port = effectivePort(url);
  return local.ports.some((p) => p !== null && p !== undefined && String(p) === port);
}

export type EnterpriseConnectFailure = 'self' | 'unreachable' | 'no-enterprise';

/**
 * Flat rather than a discriminated union: this tsconfig is not strict, so a
 * union on `ok` would not narrow at the call sites.
 */
export type EnterpriseServerResolution = {
  ok: boolean;
  /** The address to connect to on success; the typed one on failure. */
  url: string;
  /** Set when a different address than typed was used. */
  adjustedFrom?: string;
  /** Set on failure. */
  reason?: EnterpriseConnectFailure;
};

/**
 * Decide which origin to connect to. When the typed address carries an explicit
 * port and does not answer as an enterprise server, the same host on the default
 * port (the gateway) is tried before giving up — that is the right address for
 * every offline-bundle install, and the one people get wrong by appending 25808.
 */
export async function resolveEnterpriseServer(
  origin: string,
  local: LocalClientInfo,
  probe: (url: string) => Promise<EnterpriseProbeResult> = probeRemoteEnterpriseServer
): Promise<EnterpriseServerResolution> {
  const selfAddress = isOwnClientAddress(origin, local);
  const first = selfAddress ? 'no-enterprise' : await probe(origin);
  if (first === 'ok') return { ok: true, url: origin };

  const typed = new URL(origin);
  if (typed.port) {
    const gateway = `${typed.protocol}//${typed.hostname.includes(':') ? `[${typed.hostname}]` : typed.hostname}`;
    if (!isOwnClientAddress(gateway, local) && (await probe(gateway)) === 'ok') {
      return { ok: true, url: gateway, adjustedFrom: origin };
    }
  }
  return { ok: false, url: origin, reason: selfAddress ? 'self' : first };
}
