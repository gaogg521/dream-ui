/**
 * Reads/writes enterprise deployment role (server vs client) from client prefs.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  clearEnterpriseRemotePointer,
  getEnterpriseServerUrl,
  setEnterpriseServerUrl,
  setEnterpriseSession,
} from '@/common/adapter/enterpriseMode';
import { configService } from '@/common/config/configService';
import {
  appendEnterpriseServerUrlHistory,
  DEFAULT_WEBUI_DEPLOYMENT_ROLE,
  DEPLOYMENT_ROLE_CHANGED_EVENT,
  normalizeEnterpriseServerUrl,
  normalizeEnterpriseServerUrlHistory,
  resolveDeploymentRole,
  WEBUI_DEPLOYMENT_ROLE_KEY,
  WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY,
  WEBUI_ENTERPRISE_SERVER_URL_KEY,
  type WebuiDeploymentRole,
} from '@/common/config/webuiEnterpriseConfig';

export type UseDeploymentRoleResult = {
  loading: boolean;
  role: WebuiDeploymentRole;
  serverUrl: string;
  normalizedServerUrl: string | null;
  /** Previously saved server addresses, most recent first. */
  serverUrlHistory: string[];
  isClient: boolean;
  isServer: boolean;
  refresh: () => Promise<void>;
};

function readStoredServerUrl(): string {
  const raw = configService.get(WEBUI_ENTERPRISE_SERVER_URL_KEY);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Point (or unpoint) the enterprise remote at `url` for the given role. Server
 * mode hosts its own data, so it never keeps a remote pointer.
 *
 * When the *effective* client-mode URL actually changes (not merely re-saved),
 * the stored SSO session is cleared too. A session token is a JWT signed by
 * the server that issued it; sending it to a different server is meaningless
 * at best (the new server can't verify a signature from another server's
 * secret and will 401) and at worst leaves the UI showing "logged in as X"
 * for a company the user was never actually authenticated against — nothing
 * else clears this, since `persistDeploymentServerUrl` only ever touched the
 * URL keys. A same-role re-save of the identical address (e.g. clicking
 * "保存地址" again) must NOT force a re-login, so this only fires on a real
 * change, compared against what was already stored.
 */
function applyRemotePointer(role: WebuiDeploymentRole, url: string): void {
  const normalized = normalizeEnterpriseServerUrl(url);
  if (role === 'client' && normalized) {
    if (getEnterpriseServerUrl() !== normalized) {
      setEnterpriseSession(null);
    }
    setEnterpriseServerUrl(normalized);
  } else if (role === 'server') {
    clearEnterpriseRemotePointer();
  }
}

async function writeServerUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  await configService.set(WEBUI_ENTERPRISE_SERVER_URL_KEY, trimmed);
  await configService.set(
    WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY,
    appendEnterpriseServerUrlHistory(configService.get(WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY), trimmed)
  );
}

/**
 * Switch the deployment role WITHOUT touching the saved server address.
 *
 * Flipping to server used to persist an empty address, so a user who switched
 * client → server (or created a project group locally) silently lost the LAN
 * address they had typed and had to look it up again to switch back. The role
 * and the address are independent settings: server mode simply ignores the
 * address (and drops the live remote pointer) instead of erasing it.
 */
export async function persistDeploymentRole(role: WebuiDeploymentRole): Promise<void> {
  await configService.whenReady();
  await configService.set(WEBUI_DEPLOYMENT_ROLE_KEY, role);
  applyRemotePointer(role, readStoredServerUrl());
  window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
}

/** Save the client-mode server address and remember it in the history. */
export async function persistDeploymentServerUrl(url: string): Promise<void> {
  await configService.whenReady();
  await writeServerUrl(url);
  applyRemotePointer(resolveDeploymentRole(configService.get(WEBUI_DEPLOYMENT_ROLE_KEY)), url);
  window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
}

/** Forget every remembered address (the currently saved one is untouched). */
export async function clearDeploymentServerUrlHistory(): Promise<void> {
  await configService.whenReady();
  await configService.set(WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY, []);
  window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
}

export async function markDeploymentAsServer(): Promise<void> {
  await persistDeploymentRole('server');
}

async function readDeploymentConfig(): Promise<{ role: WebuiDeploymentRole; url: string; history: string[] }> {
  await configService.whenReady();
  const stored = configService.get(WEBUI_DEPLOYMENT_ROLE_KEY);
  const role = resolveDeploymentRole(stored);
  return {
    role,
    url: readStoredServerUrl(),
    history: normalizeEnterpriseServerUrlHistory(configService.get(WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY)),
  };
}

export function useDeploymentRole(): UseDeploymentRoleResult {
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<WebuiDeploymentRole>(DEFAULT_WEBUI_DEPLOYMENT_ROLE);
  const [serverUrl, setServerUrl] = useState('');
  const [serverUrlHistory, setServerUrlHistory] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await readDeploymentConfig();
      setRole(cfg.role);
      setServerUrl(cfg.url);
      setServerUrlHistory(cfg.history);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = (): void => {
      void refresh();
    };
    window.addEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, handler);
  }, [refresh]);

  const normalizedServerUrl = normalizeEnterpriseServerUrl(serverUrl);

  return {
    loading,
    role,
    serverUrl,
    normalizedServerUrl,
    serverUrlHistory,
    isClient: role === 'client',
    isServer: role === 'server',
    refresh,
  };
}
