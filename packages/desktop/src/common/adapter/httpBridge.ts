/**
 * HTTP/WS bridge factory — drop-in replacement for bridge.buildProvider / bridge.buildEmitter
 * that routes calls to dreamcore via REST API and WebSocket.
 *
 * Exported helpers produce objects with the same shape as the local IPC bridge,
 * so existing renderer code works without changes.
 */

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

import { getEnterpriseServerUrl, getEnterpriseSession, isEnterpriseRemoteActive } from './enterpriseMode';

declare global {
  interface Window {
    __backendPort?: number;
  }
}

/**
 * Resolve the backend port, honoring both renderer and main-process contexts.
 *
 * - Renderer (Electron): the preload bridge writes `window.__backendPort` before
 *   the first HTTP call, so reading from window is authoritative.
 * - Renderer (WebUI browser): no preload, so `window.__backendPort` is missing.
 *   Requests must go to the same origin that served the page; web-host's
 *   static-server reverse-proxies `/api/*` and upgrades `/ws` to the backend
 *   port. See getBaseUrl / getWsUrl below for the WebUI branch.
 * - Main process: `window` is undefined. `src/index.ts` writes the port to
 *   `globalThis.__backendPort` immediately after `backendManager.start()`
 *   resolves, so any main-process ipcBridge caller (e.g. the one-shot
 *   assistant migration hook) hits the correct port.
 * - Fallback `13400` only applies when neither is initialized — the request
 *   will still fail cleanly with ECONNREFUSED rather than masking the bug.
 */
function getBackendPort(): number {
  if (typeof window !== 'undefined' && (window as Window).__backendPort) {
    return (window as Window).__backendPort as number;
  }
  const g = globalThis as typeof globalThis & { __backendPort?: number };
  return g.__backendPort ?? 13400;
}

/**
 * WebUI (browser) mode: no Electron preload, so `window.__backendPort` is not
 * injected. Use same-origin URLs; web-host's static-server handles the reverse
 * proxy / WS upgrade to the backend.
 */
export function isWebUiBrowserMode(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Window).__backendPort;
}

/**
 * Enterprise GOVERNANCE surfaces that live on the server even for a desktop
 * client: org context/membership, admin (users/invites/audit/SSO), the
 * one-devops registries + collaboration board, and licence / spend / usage.
 * Everything NOT matching these runs on the member's local co-located dreamcore.
 *
 * ⚠️ `/api/one/billing` belongs here for the same reason `/api/one/org` does:
 * the licence, the budget and the usage ledger are enterprise-scoped rows that
 * only ever exist on the server. Routing them locally meant a client-mode
 * machine read its own empty tables — the console showed no plan, and the spend
 * cap silently passed everything. See `CompanyConsole.tsx`, whose scope table
 * already said 订阅与用量 was enterprise-scoped.
 */
const GOVERNANCE_PATH_PREFIXES = [
  '/api/one/org',
  '/api/one/admin',
  '/api/one/sso',
  '/api/one/devops',
  '/api/one/enterprise',
  '/api/one/billing',
];

function isGovernancePath(path: string): boolean {
  return GOVERNANCE_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
}

/**
 * Are shell operations happening on a machine the user cannot see?
 *
 * `/api/shell/*` (open file, reveal in folder) is not a governance path, so by
 * the rule above it always reaches the **local** dreamcore for a desktop client —
 * including in enterprise remote mode, where media jobs are local too. Revealing
 * a folder there is correct and must keep working.
 *
 * The broken case is the WebUI in a browser: the call goes to whatever server
 * served the page, so "reveal in folder" opens a window on **that** machine.
 * On the user's own machine that is still what they wanted; from another
 * machine it is a folder nobody is looking at.
 *
 * ⚠️ Deliberately a conservative heuristic with one accepted false positive:
 * reaching your own machine by its LAN address disables an action that would
 * have worked. A browser cannot tell "the server is this very machine" —
 * `location.hostname` only says what was typed. Deciding properly needs the
 * request's remote address, which is server-side knowledge.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

export function isShellHostUnreachable(): boolean {
  if (!isWebUiBrowserMode()) return false;
  if (typeof location === 'undefined') return false;
  return !LOOPBACK_HOSTS.has(location.hostname);
}

/**
 * D1 — local-first routing. The whole refactor is "local base + team
 * additive": a member's agent, conversations, skills/MCP and personal data
 * always run on the LOCAL co-located dreamcore, so they keep working when the
 * server is down and consume the locally-materialized team resources. Only
 * enterprise governance (org/admin/sso/devops) reaches the remote server in
 * client mode. Standalone & server-host modes are unaffected (no remote).
 */
function routesToRemote(path: string, options?: HttpRequestOptions): boolean {
  if (options?.preferLocalBackend) {
    return false;
  }
  return isEnterpriseRemoteActive() && isGovernancePath(path);
}

export function getBaseUrl(): string {
  if (isEnterpriseRemoteActive()) {
    return getEnterpriseServerUrl() as string;
  }
  return getLocalBaseUrl();
}

/**
 * Always targets the co-located dreamcore spawned by the desktop shell.
 */
export function getLocalBaseUrl(): string {
  if (isWebUiBrowserMode()) {
    return '';
  }
  return `http://127.0.0.1:${getBackendPort()}`;
}

function resolveRequestBaseUrl(path: string, options?: HttpRequestOptions): string {
  if (routesToRemote(path, options)) {
    const remote = getEnterpriseServerUrl();
    if (remote) {
      return remote;
    }
  }
  return getLocalBaseUrl();
}

function getWsUrl(): string {
  // D1: the conversation/agent event stream is LOCAL — a client-mode member's
  // agent runs on the co-located dreamcore, not the remote server. (Governance
  // is REST-only; nothing on the remote server needs this WS.) Browser WebUI
  // sessions are same-origin against whatever host served them.
  if (isWebUiBrowserMode()) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return `ws://127.0.0.1:${getBackendPort()}/ws`;
}

// ---------------------------------------------------------------------------
// Structured backend error
// ---------------------------------------------------------------------------

/**
 * Error thrown by `httpRequest` when the backend returns a non-2xx response.
 * Carries the structured error envelope (`success: false, error, code`) so
 * callers can branch on `code` without parsing the stringified message.
 *
 * @example
 *   try { await ipcBridge.conversation.sendMessage.invoke(...); }
 *   catch (e) {
 *     if (isBackendHttpError(e) && e.code === 'CONVERSATION_ARCHIVED') { ... }
 *   }
 */
export class BackendHttpError extends Error {
  readonly status: number;
  /** Machine-readable error code from the backend `ErrorResponse.code`, or `''` when parse failed. */
  readonly code: string;
  /** Backend-provided human message from `ErrorResponse.error`, or the raw body when parse failed. */
  readonly backendMessage: string;
  /** Structured backend metadata from `ErrorResponse.details`, when present. */
  readonly details: unknown;
  /** Raw parsed body (object on JSON response, string on text/non-JSON). */
  readonly body: unknown;

  constructor(params: { method: string; path: string; status: number; body: unknown }) {
    const { method, path, status, body } = params;
    let code = '';
    let backendMessage = '';
    let details: unknown;
    if (body && typeof body === 'object') {
      const b = body as { code?: unknown; error?: unknown; details?: unknown };
      if (typeof b.code === 'string') code = b.code;
      if (typeof b.error === 'string') backendMessage = b.error;
      details = b.details;
    } else if (typeof body === 'string') {
      backendMessage = body;
    }
    super(`Backend ${method} ${path} failed (${status}): ${JSON.stringify(body)}`);
    this.name = 'BackendHttpError';
    this.status = status;
    this.code = code;
    this.backendMessage = backendMessage;
    this.details = details;
    this.body = body;
  }
}

export function isBackendHttpError(error: unknown): error is BackendHttpError {
  // Prefer instanceof — fast path in production/bundled contexts.
  if (error instanceof BackendHttpError) return true;
  // Fallback: vite-dev HMR can split the module across chunks, breaking
  // instanceof. Detect by duck-typing on the shape produced by our
  // constructor.
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name: unknown }).name === 'BackendHttpError' &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

/**
 * Per-request overrides for `httpRequest`.
 *
 * `silentStatuses` lets known-soft failures (e.g. a runtime-scoped lookup
 * returning 404 before the agent has attached) skip the noisy `console.error`
 * and the Sentry breadcrumb that comes with it. The error is still thrown so
 * the caller's existing try/catch keeps working.
 */
export type HttpRequestOptions = {
  silentStatuses?: number[];
  /** Route to the local co-located dreamcore instead of the enterprise remote server. */
  preferLocalBackend?: boolean;
  /**
   * Client-side request timeout in milliseconds. Defaults to
   * {@link DEFAULT_REQUEST_TIMEOUT_MS}. Pass `0` to disable the timeout for a
   * genuinely long-lived request. When it fires, the fetch is aborted and a
   * `BackendHttpError` with `status: 0` / code `REQUEST_TIMEOUT` is thrown, so
   * a hung backend surfaces as an error the caller can handle instead of an
   * indefinite spinner.
   */
  timeoutMs?: number;
  /** Extra request headers merged on top of the default `Content-Type`. */
  headers?: Record<string, string>;
};

/**
 * Default client request timeout. Aligned with the backend's ~5-minute idle
 * window: long enough not to cut off a legitimately slow REST call, short
 * enough that a wedged server fails the request instead of spinning forever.
 * Streaming/agent traffic goes over WebSocket, not `httpRequest`, so this
 * ceiling never truncates a live token stream.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

const SENSITIVE_LOG_KEY_PATTERN = /api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret/i;

function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_LOG_KEY_PATTERN.test(key) ? '[REDACTED]' : redactForLog(entry, depth + 1),
    ])
  );
}

export async function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: HttpRequestOptions
): Promise<T> {
  const remote = routesToRemote(path, options);
  const url = `${resolveRequestBaseUrl(path, options)}${path}`;
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  // Only remote governance requests carry the enterprise Bearer token (no
  // cross-origin cookie jar; the backend skips CSRF for Bearer requests).
  // Local requests hit the co-located dreamcore which runs without a session.
  if (remote) {
    const session = getEnterpriseSession();
    if (session) {
      headers['Authorization'] = `Bearer ${session.token}`;
    }
  }

  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  console.debug(
    `[httpBridge] ${method} ${path}${remote ? ' (remote)' : ' (local)'}`,
    body !== undefined ? JSON.stringify(redactForLog(body)).slice(0, 500) : '(no body)'
  );

  // Abort the request if the backend never responds, so a wedged server
  // surfaces as a catchable error rather than an indefinite spinner. This
  // layer never retries on its own — it just throws — so the timeout cannot
  // turn into a retry storm (focus-triggered re-fetches are throttled by their
  // own cooldown elsewhere).
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = timeoutMs > 0 ? new AbortController() : undefined;
  const timeoutHandle = controller !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
      // Local co-located dreamcore runs with --local in dev (no session cookie).
      // Sending credentials cross-origin (localhost:5173 → 127.0.0.1:port) makes
      // the browser reject responses when CORS uses Allow-Origin: *.
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      const message = `request timed out after ${timeoutMs}ms`;
      console.error(`[httpBridge] ${method} ${path} → ${message}`);
      throw new BackendHttpError({ method, path, status: 0, body: { code: 'REQUEST_TIMEOUT', error: message } });
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }

  if (!response.ok) {
    // Response body can only be consumed once — read as text, then try JSON
    const rawText = await response.text().catch(() => '');
    let errorBody: unknown;
    try {
      errorBody = JSON.parse(rawText);
    } catch {
      errorBody = rawText;
    }
    if (options?.silentStatuses?.includes(response.status)) {
      console.debug(`[httpBridge] ${method} ${path} → ${response.status} (silenced)`, errorBody);
    } else {
      console.error(`[httpBridge] ${method} ${path} → ${response.status}`, errorBody);
    }
    throw new BackendHttpError({ method, path, status: response.status, body: errorBody });
  }

  console.debug(`[httpBridge] ${method} ${path} → ${response.status} OK`);

  const contentType = response.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return undefined as T;
  }

  const json = await response.json();
  // Backend wraps in { success, data, ... } — unwrap when present
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Provider factories (same shape as bridge.buildProvider)
// ---------------------------------------------------------------------------

type ProviderLike<Data, Params> = {
  provider: (handler: (params: Params) => Promise<Data>) => void;
  invoke: Params extends undefined ? () => Promise<Data> : (params: Params) => Promise<Data>;
};

export function withResponseMap<Raw, Mapped, Params>(
  inner: ProviderLike<Raw, Params>,
  map: (data: Raw) => Mapped
): ProviderLike<Mapped, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const raw = await (inner.invoke as (p?: Params) => Promise<Raw>)(params);
      return map(raw);
    }) as ProviderLike<Mapped, Params>['invoke'],
  };
}

export function httpGet<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  options?: HttpRequestOptions
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      return httpRequest<Data>('GET', resolvedPath, undefined, options);
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

export function httpPost<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      const body = mapBody ? mapBody(params!) : params;
      return httpRequest<Data>('POST', resolvedPath, body);
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

export function httpPut<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown,
  mapHeaders?: (params: Params) => Record<string, string> | undefined
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      const body = mapBody ? mapBody(params!) : params;
      const headers = mapHeaders ? mapHeaders(params!) : undefined;
      return httpRequest<Data>('PUT', resolvedPath, body, headers ? { headers } : undefined);
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

export function httpPatch<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      const body = mapBody ? mapBody(params!) : params;
      return httpRequest<Data>('PATCH', resolvedPath, body);
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

export function httpDelete<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  options?: HttpRequestOptions
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      return httpRequest<Data>('DELETE', resolvedPath, undefined, options);
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

/** Personal digital-employee APIs — always local dreamcore on desktop (see getLocalBaseUrl). */
const LOCAL_BACKEND: HttpRequestOptions = { preferLocalBackend: true };

export function httpGetLocal<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  options?: HttpRequestOptions
): ProviderLike<Data, Params> {
  return httpGet(path, { ...LOCAL_BACKEND, ...options });
}

export function httpPostLocal<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown,
  options?: HttpRequestOptions
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      const body = mapBody ? mapBody(params!) : params;
      return httpRequest<Data>('POST', resolvedPath, body, { ...LOCAL_BACKEND, ...options });
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

export function httpPutLocal<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  mapBody?: (params: Params) => unknown,
  options?: HttpRequestOptions
): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (params?: Params) => {
      const resolvedPath = typeof path === 'function' ? path(params!) : path;
      const body = mapBody ? mapBody(params!) : params;
      return httpRequest<Data>('PUT', resolvedPath, body, { ...LOCAL_BACKEND, ...options });
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

export function httpDeleteLocal<Data, Params = undefined>(
  path: string | ((params: Params) => string),
  options?: HttpRequestOptions
): ProviderLike<Data, Params> {
  return httpDelete(path, { ...LOCAL_BACKEND, ...options });
}

/**
 * Stub provider for features not yet implemented in the backend.
 * Returns a sensible default value and logs a warning.
 */
export function stubProvider<Data, Params = undefined>(name: string, defaultValue: Data): ProviderLike<Data, Params> {
  return {
    provider: () => {},
    invoke: (async (_params?: Params) => {
      console.warn(`[httpBridge] stub: ${name} not yet implemented in backend`);
      return defaultValue;
    }) as ProviderLike<Data, Params>['invoke'],
  };
}

// ---------------------------------------------------------------------------
// WebSocket singleton
// ---------------------------------------------------------------------------

type WsCallback = (data: unknown) => void;
const REALTIME_RECONNECTED_EVENT = 'realtime.reconnected';
const wsListeners = new Map<string, Set<WsCallback>>();
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsReconnectAttempt = 0;
let wsHasOpened = false;

function dispatchWsEvent(eventName: string, payload: unknown): void {
  const handlers = wsListeners.get(eventName);
  if (!handlers) return;
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch {
      /* never crash listener */
    }
  }
}

function ensureWs(): void {
  if (typeof window === 'undefined') {
    console.debug('[ensureWs] skipped: no window');
    return;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    console.debug('[ensureWs] skipped: already open/connecting, readyState=', ws.readyState);
    return;
  }

  const url = getWsUrl();
  console.debug('[ensureWs] connecting to', url);
  try {
    // Browser WebSocket cannot set an Authorization header; the backend
    // accepts the token as the first Sec-WebSocket-Protocol value (and the
    // realtime handler echoes it back so the handshake completes).
    const wsToken = isEnterpriseRemoteActive() ? getEnterpriseSession()?.token : undefined;
    ws = wsToken ? new WebSocket(url, [wsToken]) : new WebSocket(url);
  } catch (e) {
    console.error('[ensureWs] WebSocket constructor threw:', e);
    scheduleWsReconnect();
    return;
  }

  const current = ws;

  current.addEventListener('open', () => {
    console.debug('[ensureWs] CONNECTED');
    const isReconnect = wsHasOpened;
    wsHasOpened = true;
    wsReconnectAttempt = 0;
    if (isReconnect) {
      dispatchWsEvent(REALTIME_RECONNECTED_EVENT, { timestamp: Date.now() });
    }
  });

  current.addEventListener('close', (e) => {
    console.debug('[ensureWs] CLOSED code=' + e.code + ' reason=' + e.reason);
    if (ws === current) ws = null;
    scheduleWsReconnect();
  });

  current.addEventListener('error', (e) => {
    console.error('[ensureWs] ERROR', e);
    current.close();
  });

  current.addEventListener('message', (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as {
        name?: string;
        event?: string;
        data?: unknown;
        payload?: unknown;
      };
      const eventName = msg.name ?? msg.event;
      const payload = msg.data ?? msg.payload;
      console.debug('[WS:msg]', eventName, JSON.stringify(payload).slice(0, 200));
      if (eventName) {
        dispatchWsEvent(eventName, payload);
      }
    } catch {
      // ignore non-JSON
    }
  });
}

function scheduleWsReconnect(): void {
  if (wsReconnectTimer) return;
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempt), 30000);
  wsReconnectAttempt++;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    ensureWs();
  }, delay);
}

/**
 * Send an outbound frame over the shared WS singleton, wrapped in the realtime
 * envelope `{ name, data }` (backend routes by `name`; the fs monitor uses
 * `name === "fs"`, see stage-1 protocol.md v3).
 *
 * Ordered-stream semantics: if the socket is not OPEN the frame is **dropped**
 * (never buffered). The caller re-declares full state on reconnect (the monitor
 * client zeroes `current` and re-subscribes via `realtime.reconnected`), so a
 * dropped outbound never leaves an undetectable gap. Returns `true` when the
 * frame was handed to the socket.
 */
export function wsSend(name: string, data: unknown): boolean {
  ensureWs();
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  try {
    ws.send(JSON.stringify({ name, data }));
    return true;
  } catch (e) {
    console.error('[wsSend] send failed:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Emitter factory (same shape as bridge.buildEmitter)
// ---------------------------------------------------------------------------

type EmitterLike<Params> = {
  on: (callback: Params extends undefined ? () => void : (params: Params) => void) => () => void;
  emit: Params extends undefined ? () => void : (params: Params) => void;
};

export function wsEmitter<Params = undefined>(eventName: string): EmitterLike<Params> {
  return {
    on: (callback: (params: Params) => void) => {
      ensureWs();
      if (!wsListeners.has(eventName)) {
        wsListeners.set(eventName, new Set());
      }
      const cb = callback as WsCallback;
      wsListeners.get(eventName)!.add(cb);
      return () => {
        wsListeners.get(eventName)?.delete(cb);
      };
    },
    emit: (() => {}) as EmitterLike<Params>['emit'],
  };
}

export function wsMappedEmitter<Params = undefined>(
  eventName: string,
  transform: (raw: unknown) => Params
): EmitterLike<Params> {
  const inner = wsEmitter<unknown>(eventName);
  return {
    on: (callback: (params: Params) => void) => {
      return inner.on((raw) => {
        callback(transform(raw));
      });
    },
    emit: (() => {}) as EmitterLike<Params>['emit'],
  };
}

/**
 * Stub emitter for events not yet implemented in the backend.
 */
export function stubEmitter<Params = undefined>(_name: string): EmitterLike<Params> {
  return {
    on: () => () => {},
    emit: (() => {}) as EmitterLike<Params>['emit'],
  };
}
