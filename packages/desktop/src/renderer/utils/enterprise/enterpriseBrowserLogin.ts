/**
 * Desktop enterprise login — always hand off SSO / LDAP / local auth to the
 * system browser (WebUI or remote aioncore). The desktop app only provides
 * entry points; credentials never belong in the Electron UI.
 */

import { ipcBridge } from '@/common';
import { getEnterpriseServerUrl, setEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { openExternalUrl } from '@/renderer/utils/platform';

export type OAuthProvider = 'feishu' | 'dingtalk' | 'wecom' | 'oidc';

/**
 * The OS protocol scheme THIS build claimed for `aionui://`-style deep
 * links (injected by preload from the main process's `PROTOCOL_SCHEME` —
 * dev and packaged builds use different schemes so they stop stealing each
 * other's OS-level registration). Told to the backend via the `scheme`
 * query param on the desktop OAuth flow so the callback page hands the
 * token back to whichever build actually initiated the login.
 */
function getDeepLinkScheme(): string {
  return window.__deepLinkScheme || 'aionui';
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

export async function openWebuiAdminLogin(returnTo = '/enterprise/console'): Promise<boolean> {
  const webui = await ensureWebuiRunning();
  if (!webui) return false;
  const url = buildWebuiHashLoginUrl(webui.localUrl, { mode: 'admin', redirect: returnTo });
  await openExternalUrl(url);
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

export async function openEnterprisePasswordLoginInBrowser(returnTo = '/settings/enterprise'): Promise<boolean> {
  return openWebuiEnterpriseLogin(returnTo);
}
