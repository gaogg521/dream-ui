/**
 * Enterprise remote mode — desktop client pointing at a remote dreamcore.
 *
 * State lives in renderer localStorage: httpBridge reads it synchronously on
 * every request to pick the base URL and attach the Bearer token. The main
 * process never sees these keys (no window/localStorage there), so its own
 * ipcBridge calls keep hitting the local backend.
 */

import { bridge } from '@/common/platform/bridge';
import type { IRuntimeNodeIdentity } from './ipcBridge';

export type EnterpriseSession = {
  token: string;
  userId: string;
  username: string;
  /** Human-readable display name from the IdP (e.g. Feishu's 赵高). Optional:
   * older callbacks and non-SSO logins don't provide it, fall back to username. */
  name?: string;
};

const KEY_ENABLED = 'one-enterprise:enabled';
const KEY_SERVER_URL = 'one-enterprise:server-url';
const KEY_SESSION = 'one-enterprise:session';

function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function isEnterpriseModeEnabled(): boolean {
  return storage()?.getItem(KEY_ENABLED) === 'true';
}

export function setEnterpriseModeEnabled(enabled: boolean): void {
  storage()?.setItem(KEY_ENABLED, enabled ? 'true' : 'false');
}

/** Normalized (no trailing slash) http(s) origin of the remote server, or null. */
export function getEnterpriseServerUrl(): string | null {
  const raw = storage()?.getItem(KEY_SERVER_URL)?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export function setEnterpriseServerUrl(url: string): void {
  storage()?.setItem(KEY_SERVER_URL, url.trim());
}

/** Clear remote-server pointer (e.g. when switching deployment back to server). */
export function clearEnterpriseRemotePointer(): void {
  storage()?.removeItem(KEY_SERVER_URL);
  storage()?.removeItem(KEY_SESSION);
  storage()?.setItem(KEY_ENABLED, 'false');
}

export function getEnterpriseSession(): EnterpriseSession | null {
  const raw = storage()?.getItem(KEY_SESSION);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EnterpriseSession;
    return parsed && typeof parsed.token === 'string' && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function setEnterpriseSession(session: EnterpriseSession | null): void {
  if (session) {
    storage()?.setItem(KEY_SESSION, JSON.stringify(session));
  } else {
    storage()?.removeItem(KEY_SESSION);
  }
}

/** Remote mode is active when the toggle is on AND a server URL is set. */
export function isEnterpriseRemoteActive(): boolean {
  return isEnterpriseModeEnabled() && getEnterpriseServerUrl() !== null;
}

/**
 * This machine's locally-persisted identity (C1-2 fix), cached after the
 * first read so every governance request does not pay for an IPC round trip
 * — the id never changes at runtime, same reasoning as `mintedChannelTokens`
 * in `teamSkillSync.ts`.
 *
 * Calls the main process directly via the low-level `bridge.invoke` primitive
 * (the same one `ipcBridge.ts`'s providers are built on) rather than
 * importing `ipcBridge` itself: `ipcBridge.ts` imports from `httpBridge.ts`,
 * which imports from this module, so importing `ipcBridge` here would close
 * a cycle. `IRuntimeNodeIdentity` is imported type-only, which erases at
 * compile time and carries no such risk.
 *
 * Bounded by a timeout, not just a try/catch: `bridge.invoke` resolves only
 * when a matching `emit` answers it (see `common/platform/bridge.ts`) — a
 * main process that is slow, wedged, or simply never wired to answer this
 * channel leaves the promise pending forever, which would hang every single
 * governance HTTP call behind it. Header on a slow reply that arrives late
 * is not worth turning "add a header" into "requests can hang forever" to get.
 */
const MACHINE_ID_LOOKUP_TIMEOUT_MS = 2000;
let cachedMachineId: string | null = null;
export async function getCachedMachineId(): Promise<string | null> {
  if (cachedMachineId) return cachedMachineId;
  try {
    const identity = await Promise.race([
      bridge.invoke<IRuntimeNodeIdentity>('app.get-runtime-node-identity'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('machine identity lookup timed out')), MACHINE_ID_LOOKUP_TIMEOUT_MS)
      ),
    ]);
    cachedMachineId = identity.machineId || null;
  } catch {
    // Best-effort — the header just gets omitted, and every server-side
    // check that reads it already fails open when it is absent. Not cached:
    // a transient main-process hiccup should not permanently disable the
    // header for the rest of the session.
  }
  return cachedMachineId;
}
