/**
 * Enterprise remote mode — desktop client pointing at a remote dreamcore.
 *
 * State lives in renderer localStorage: httpBridge reads it synchronously on
 * every request to pick the base URL and attach the Bearer token. The main
 * process never sees these keys (no window/localStorage there), so its own
 * ipcBridge calls keep hitting the local backend.
 */

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
