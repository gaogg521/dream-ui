/**
 * Reads/writes the enterprise server address from client prefs. The role is
 * always client now (see `webuiEnterpriseConfig.ts`); `role` / `isClient`
 * stay in the result so existing callers keep compiling.
 */

import { useCallback, useEffect, useState } from 'react';
import { getEnterpriseServerUrl, setEnterpriseServerUrl, setEnterpriseSession } from '@/common/adapter/enterpriseMode';
import { ORG_CONTEXT_CHANGED_EVENT } from '@renderer/pages/enterprise/hooks/useOrgContext';
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
  refresh: () => Promise<void>;
};

function readStoredServerUrl(): string {
  const raw = configService.get(WEBUI_ENTERPRISE_SERVER_URL_KEY);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Point the enterprise remote at `url`.
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
function applyRemotePointer(url: string): void {
  const normalized = normalizeEnterpriseServerUrl(url);
  let identityChanged = false;
  if (normalized) {
    if (getEnterpriseServerUrl() !== normalized) {
      setEnterpriseSession(null);
      identityChanged = true;
    }
    setEnterpriseServerUrl(normalized);
  }
  if (identityChanged) {
    // Re-pointing at a different server changes
    // what "my org" means, and everything derived from the org context must
    // re-derive: the team-resource sync's leaving purge (C0-1's channel
    // clearing rides it too) keys on that context flipping to
    // not-enterprise, and it never fires unless the context refetches.
    // DEPLOYMENT_ROLE_CHANGED_EVENT alone does not reach those hooks — which
    // is exactly how an enterprise-issued model channel survived the switch
    // back to the personal workspace.
    window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
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

/** Save the server address and remember it in the history. */
export async function persistDeploymentServerUrl(url: string): Promise<void> {
  await configService.whenReady();
  await writeServerUrl(url);
  applyRemotePointer(url);
  window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
}

/** Forget every remembered address (the currently saved one is untouched). */
export async function clearDeploymentServerUrlHistory(): Promise<void> {
  await configService.whenReady();
  await configService.set(WEBUI_ENTERPRISE_SERVER_URL_HISTORY_KEY, []);
  window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
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
    refresh,
  };
}
