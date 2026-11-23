import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ENTERPRISE_CONNECTION_CHANGED_EVENT, getEnterpriseConnectionScope } from '@/common/adapter/enterpriseMode';
import { ipcBridge } from '@/common';
import type { IMcpServer } from '@/common/config/storage';
import { ensureBackendMcpCatalog, subscribeMcpEnabledChanges } from './catalog';

export const getMcpSettingsScope = getEnterpriseConnectionScope;

function subscribeScope(listener: () => void) {
  window.addEventListener(ENTERPRISE_CONNECTION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ENTERPRISE_CONNECTION_CHANGED_EVENT, listener);
}

export function useMcpSettingsScope(): string {
  return useSyncExternalStore(subscribeScope, getMcpSettingsScope, () => 'local');
}

/**
 * MCP server state hook.
 * Combines backend-managed user servers with extension-contributed servers.
 */
export const useMcpServers = () => {
  const scope = useMcpSettingsScope();
  const [mcpServers, setMcpServers] = useState<IMcpServer[]>([]);
  const [extensionMcpServers, setExtensionMcpServers] = useState<IMcpServer[]>([]);
  const [isMcpServersLoading, setIsMcpServersLoading] = useState(true);

  useEffect(
    () =>
      subscribeMcpEnabledChanges((id, enabled) => {
        setMcpServers((servers) => servers.map((server) => (server.id === id ? { ...server, enabled } : server)));
      }),
    []
  );

  useEffect(() => {
    let active = true;
    setMcpServers([]);
    setIsMcpServersLoading(true);
    void ensureBackendMcpCatalog()
      .then(({ allServers }) => {
        if (active) setMcpServers(allServers);
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load MCP catalog:', error);
        if (active) setMcpServers([]);
      })
      .finally(() => {
        if (active) setIsMcpServersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [scope]);

  useEffect(() => {
    void ipcBridge.extensions.getMcpServers
      .invoke()
      .then((extServers) => {
        if (!extServers || extServers.length === 0) {
          setExtensionMcpServers([]);
          return;
        }

        const converted: IMcpServer[] = extServers.map((server) => ({
          id: String(server.id || ''),
          name: String(server.name || ''),
          description: server.description as string | undefined,
          enabled: server.enabled !== false,
          transport: server.transport as IMcpServer['transport'],
          created_at: (server.created_at as number) || Date.now(),
          updated_at: (server.updated_at as number) || Date.now(),
          original_json: String(server.original_json || '{}'),
          builtin: false,
        }));
        setExtensionMcpServers(converted);
      })
      .catch((error) => {
        console.error('[useMcpServers] Failed to load extension MCP servers:', error);
        setExtensionMcpServers([]);
      });
  }, []);

  const saveMcpServers = useCallback((serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
    setMcpServers((prevServers) =>
      typeof serversOrUpdater === 'function' ? serversOrUpdater(prevServers) : serversOrUpdater
    );
    return Promise.resolve();
  }, []);

  return {
    mcpServers,
    isMcpServersLoading,
    allMcpServers: [...mcpServers, ...extensionMcpServers],
    extensionMcpServers,
    setMcpServers,
    saveMcpServers,
  };
};
