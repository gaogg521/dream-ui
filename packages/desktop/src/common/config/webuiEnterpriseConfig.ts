/**
 * Enterprise connection settings stored in client preferences
 * (`configService` / `/api/settings/client`).
 *
 * `webui.deploymentRole` is a leftover from when the enterprise server shipped
 * inside the desktop bundle and one machine per LAN played "server". Hosting
 * now lives in the separate enterprise edition, so every desktop install is a
 * client; a stored `server` is read as `client` (the personal build cannot
 * host — its local `/api/one/org/*` answers 501), which also releases anyone
 * still carrying that value from an old build. The key and type stay so old
 * preference files keep parsing.
 */

export type WebuiDeploymentRole = 'server' | 'client';

export const WEBUI_DEPLOYMENT_ROLE_KEY = 'webui.deploymentRole' as const;
export const WEBUI_ENTERPRISE_SERVER_URL_KEY = 'webui.enterpriseServerUrl' as const;
/**
 * Previously used project-group server addresses, most recent first. Typing a
 * LAN address with port by hand every time is error-prone, and a role switch
 * used to drop the current address entirely — the history keeps it recoverable.
 */
export const WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY = 'webui.enterpriseServerUrlHistory' as const;

/** Upper bound on remembered addresses; older entries fall off the end. */
export const MAX_ENTERPRISE_SERVER_URL_HISTORY = 8;

export const DEFAULT_WEBUI_DEPLOYMENT_ROLE: WebuiDeploymentRole = 'client';

export const DEPLOYMENT_ROLE_CHANGED_EVENT = 'one-deployment-role-changed';

/** Always `client` — see the module comment for why a stored `server` is ignored. */
export function resolveDeploymentRole(_stored: unknown): WebuiDeploymentRole {
  return DEFAULT_WEBUI_DEPLOYMENT_ROLE;
}

/** Normalize a user-entered server address to an http(s) origin. */
export function normalizeEnterpriseServerUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/**
 * Coerce whatever is stored under the history key into a clean, de-duplicated,
 * capped list of origins. Stored values come from client preferences, so they
 * must be treated as untrusted (older builds, hand-edited config, …).
 */
export function normalizeEnterpriseServerUrlHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizeEnterpriseServerUrl(entry);
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
    if (result.length >= MAX_ENTERPRISE_SERVER_URL_HISTORY) break;
  }
  return result;
}

/** Put `rawUrl` at the front of the history, keeping entries unique and capped. */
export function appendEnterpriseServerUrlHistory(history: unknown, rawUrl: string | null | undefined): string[] {
  const existing = normalizeEnterpriseServerUrlHistory(history);
  const normalized = normalizeEnterpriseServerUrl(rawUrl);
  if (!normalized) return existing;
  return [normalized, ...existing.filter((item) => item !== normalized)].slice(0, MAX_ENTERPRISE_SERVER_URL_HISTORY);
}
