/**
 * Copyright 2026 One Work
 */

/**
 * Where the main process should send *governance* requests.
 *
 * The enterprise server URL and the member's bearer token live in renderer
 * localStorage, which the main process cannot read (see
 * `common/adapter/enterpriseMode.ts`). So anything running here that needs to
 * reach company-scoped data — the team knowledge base, the media spend gate —
 * would otherwise silently query the member's own local backend, where the
 * company simply does not exist: no membership row, no licence, no budget.
 *
 * The renderer pushes the endpoint down via `ipcBridge.application.setGovernanceEndpoint`
 * whenever it changes, and callers here route through {@link governanceFetch}.
 *
 * Falling back to the local backend when nothing was pushed is deliberate and
 * safe: with no token the local backend resolves the caller to the desktop
 * operator, which is exactly right for personal and server-host deployments
 * where the company data *is* local.
 *
 * This module owns only the pointer. Access control is never re-implemented on
 * this side — the backend applies the caller's own scope to whatever is asked.
 */

export type GovernanceEndpoint = {
  baseUrl: string;
  token: string;
  machineId?: string;
};

/** In-memory only — never persisted, never logged. */
let governanceEndpoint: GovernanceEndpoint | null = null;

/**
 * Point governance requests at the remote server. Called by the renderer when
 * enterprise remote mode turns on, and with `null` only when remote mode turns off. A missing session
 * retains the remote pointer and requires sign-in.
 */
export function setGovernanceEndpoint(endpoint: GovernanceEndpoint | null): void {
  // A configured company without a session must never silently query the personal database.
  governanceEndpoint = endpoint?.baseUrl ? { ...endpoint, baseUrl: endpoint.baseUrl.replace(/\/+$/, '') } : null;
}

export function getGovernanceEndpoint(): GovernanceEndpoint | null {
  return governanceEndpoint;
}

/** Base URL of the co-located dreamcore, or null before the backend is up. */
export function localBackendBaseUrl(): string | null {
  const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  return port ? `http://127.0.0.1:${port}` : null;
}

/**
 * Whether governance requests currently reach a remote company server.
 *
 * Exposed so callers can tell "the company said no" apart from "there is no
 * company here", which are very different things to report to a user.
 */
export function isGovernanceRemote(): boolean {
  return governanceEndpoint !== null;
}

export class GovernanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GovernanceUnavailableError';
  }
}

/**
 * Call a governance endpoint on whichever backend currently owns it.
 *
 * `path` is an absolute API path (`/api/one/...`). The bearer token is attached
 * only for remote calls — the local backend runs without a session.
 *
 * Returns the unwrapped `data` of the backend's `{ success, data }` envelope,
 * matching what `httpBridge.httpRequest` hands renderer callers, so a module
 * can be moved between the two without its response handling changing.
 *
 * Throws {@link GovernanceUnavailableError} when no backend is reachable at all
 * and a plain `Error` carrying the status for a non-2xx answer.
 */
export async function governanceFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const remote = governanceEndpoint;
  const baseUrl = remote ? remote.baseUrl : localBackendBaseUrl();
  if (!baseUrl) {
    throw new GovernanceUnavailableError('backend is not running');
  }
  if (remote && !remote.token) {
    throw new GovernanceUnavailableError(
      'Enterprise sign-in is required. Sign in to the configured enterprise server.'
    );
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (remote) headers['Authorization'] = `Bearer ${remote.token}`;
  if (remote?.machineId) headers['x-dream-machine-id'] = remote.machineId;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new GovernanceUnavailableError(
      remote
        ? 'Enterprise connection unavailable. Check the enterprise server connection and retry.'
        : 'Local backend connection unavailable. Retry when the backend is ready.'
    );
  }

  if (!response.ok) {
    if (remote && response.status === 401) {
      throw new GovernanceUnavailableError('Enterprise sign-in expired. Sign in again to use enterprise knowledge.');
    }
    // Surface the status, not the body: an error page from a misconfigured
    // remote can be large and tells the caller nothing it can act on.
    throw new Error(`${method} ${path} returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) throw new Error('Governance server returned an invalid response.');

  const json = (await response.json()) as unknown;
  if (json && typeof json === 'object' && 'success' in json && json.success === false) {
    throw new Error('Governance server rejected the request.');
  }
  if (json && typeof json === 'object' && 'data' in json) {
    return (json as { data: T }).data;
  }
  return json as T;
}
