/**
 * Desktop enterprise login — always hand off SSO / LDAP / local auth to the
 * system browser (WebUI or remote dreamcore). The desktop app only provides
 * entry points; credentials never belong in the Electron UI.
 */

import { ipcBridge } from '@/common';
import {
  getEnterpriseServerUrl,
  isEnterpriseModeEnabled,
  setEnterpriseServerUrl,
} from '@/common/adapter/enterpriseMode';
import { openExternalUrl } from '@/renderer/utils/platform';

export type OAuthProvider = 'feishu' | 'dingtalk' | 'wecom' | 'oidc';

/**
 * The OS protocol scheme THIS build claimed for `dream://`-style deep
 * links (injected by preload from the main process's `PROTOCOL_SCHEME` —
 * dev and packaged builds use different schemes so they stop stealing each
 * other's OS-level registration). Told to the backend via the `scheme`
 * query param on the desktop OAuth flow so the callback page hands the
 * token back to whichever build actually initiated the login.
 */
function getDeepLinkScheme(): string {
  return window.__deepLinkScheme || 'dream';
}

export async function ensureWebuiRunning(): Promise<{ localUrl: string } | null> {
  try {
    let status = await ipcBridge.webui.getStatus.invoke();
    if (!status?.running) {
      const started = await ipcBridge.webui.start.invoke({});
      if (started?.localUrl) {
        return { localUrl: started.localUrl.replace(/\/+$/, '') };
      }
      status = await ipcBridge.webui.getStatus.invoke();
    }
    if (status?.running && status.localUrl) {
      return { localUrl: status.localUrl.replace(/\/+$/, '') };
    }
  } catch {
    // WebUI unavailable — caller shows a message.
  }
  return null;
}

function buildWebuiHashLoginUrl(localUrl: string, query: Record<string, string>): string {
  const params = new URLSearchParams(query);
  return `${localUrl}/#/login?${params.toString()}`;
}

export async function openWebuiEnterpriseLogin(returnTo = '/settings/enterprise'): Promise<boolean> {
  const webui = await ensureWebuiRunning();
  if (!webui) return false;
  const url = buildWebuiHashLoginUrl(webui.localUrl, { mode: 'enterprise', redirect: returnTo });
  await openExternalUrl(url);
  return true;
}

/**
 * Open the enterprise admin console in the system browser.
 *
 * The console is no longer part of this app — it is a separate SPA served at
 * `/admin` by the same gateway that fronts the backend. So the destination is
 * whichever dreamcore this machine defers to: the remote server when running
 * as a client, otherwise the WebUI this machine hosts.
 *
 * Returns false when neither is reachable (server mode with the WebUI not
 * running and unable to start), so the caller can say why nothing happened.
 */
export async function openAdminConsole(path = '/'): Promise<boolean> {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const remote = getEnterpriseServerUrl()?.replace(/\/+$/, '') ?? null;
  if (remote) {
    await openExternalUrl(`${remote}/admin${suffix === '/' ? '' : suffix}`);
    return true;
  }
  const webui = await ensureWebuiRunning();
  if (!webui) return false;
  await openExternalUrl(`${webui.localUrl}/admin${suffix === '/' ? '' : suffix}`);
  return true;
}

export async function openEnterpriseOAuthInBrowser(
  provider: OAuthProvider,
  options?: { redirect?: string; remoteOrigin?: string | null }
): Promise<boolean> {
  const redirect = options?.redirect ?? '/settings/enterprise';
  const remote = (options?.remoteOrigin ?? getEnterpriseServerUrl())?.replace(/\/+$/, '') ?? null;

  if (remote) {
    setEnterpriseServerUrl(remote);
    const params = new URLSearchParams({ desktop: '1', redirect, scheme: getDeepLinkScheme() });
    await openExternalUrl(`${remote}/api/one/sso/${provider}/authorize?${params.toString()}`);
    return true;
  }

  const webui = await ensureWebuiRunning();
  if (!webui) return false;
  const params = new URLSearchParams({ redirect });
  await openExternalUrl(`${webui.localUrl}/api/one/sso/${provider}/authorize?${params.toString()}`);
  return true;
}

/**
 * Password-class logins (LDAP / local account) in the system browser.
 *
 * CONNECTED to a remote server (mode flag on) → open the REMOTE admin
 * console's login page (`/admin/login` — BrowserRouter with basename
 * `/admin`, never the WebUI's `/#/login` hash shape) with the desktop
 * handshake params. The console hands the session token back via
 * `{scheme}://sso-callback` — the same deep link the OAuth callback page
 * renders — because the browser's cookie jar is not shared with the desktop
 * renderer: without the deep link, login would succeed in the browser and
 * the app would still read as logged out.
 *
 * The remote branch keys on `isEnterpriseModeEnabled()`, NOT on a saved
 * address: a merely-saved URL with the connect toggle OFF is the
 * disconnected state, and per the personal/server-mode fallback contract it
 * must keep opening the LOCAL WebUI login — the saved address alone never
 * reroutes the user's login destination.
 */
export async function openEnterprisePasswordLoginInBrowser(
  returnTo = '/settings/enterprise',
  options?: { remoteOrigin?: string | null; desktop?: boolean }
): Promise<boolean> {
  const remote = (options?.remoteOrigin ?? getEnterpriseServerUrl())?.replace(/\/+$/, '') ?? null;
  const desktop = options?.desktop ?? true;

  if (remote && desktop && isEnterpriseModeEnabled()) {
    const params = new URLSearchParams({
      desktop: '1',
      scheme: getDeepLinkScheme(),
      redirect: returnTo,
    });
    await openExternalUrl(`${remote}/admin/login?${params.toString()}`);
    return true;
  }
  if (remote && !desktop) {
    const params = new URLSearchParams({ redirect: returnTo });
    await openExternalUrl(`${remote}/admin/login?${params.toString()}`);
    return true;
  }
  return openWebuiEnterpriseLogin(returnTo);
}
