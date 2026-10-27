import { useState, useCallback, useRef } from 'react';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';

export interface McpOAuthStatus {
  isAuthenticated: boolean;
  needsLogin: boolean;
  isChecking: boolean;
  error?: string;
}

/** Minimum interval between two OAuth status checks for the same server. */
const OAUTH_CHECK_THROTTLE_MS = 30_000;
/** Upper bound on concurrent OAuth status requests. */
const OAUTH_CHECK_CONCURRENCY = 8;

/**
 * MCP OAuth 管理 Hook
 * 处理 MCP 服务器的 OAuth 认证状态检查和登录流程
 */
export const useMcpOAuth = () => {
  const [oauthStatus, setOAuthStatus] = useState<Record<string, McpOAuthStatus>>({});
  const [loggingIn, setLoggingIn] = useState<Record<string, boolean>>({});
  // Enterprise deployments push hundreds of URL-based MCP servers, and every
  // mcpServers state update re-runs the effects that call checkOAuthStatus.
  // Without per-server dedupe and throttling that meant hundreds of
  // concurrent backend requests within a second — the OAuth-check storm that
  // froze the client after an enterprise join.
  const lastCheckAtRef = useRef(new Map<string, number>());
  const inFlightRef = useRef(new Set<string>());

  const getOAuthServerUrl = useCallback((server: IMcpServer): string | null => {
    if (
      server.transport.type === 'http' ||
      server.transport.type === 'sse' ||
      server.transport.type === 'streamable_http'
    ) {
      return server.transport.url;
    }
    return null;
  }, []);

  // 检查 OAuth 状态
  const checkOAuthStatus = useCallback(
    async (server: IMcpServer, options?: { force?: boolean }) => {
      const serverUrl = getOAuthServerUrl(server);
      if (!serverUrl) {
        return;
      }

      const throttleKey = `${server.id}|${serverUrl}`;
      if (!options?.force) {
        if (inFlightRef.current.has(throttleKey)) {
          return;
        }
        const lastCheckedAt = lastCheckAtRef.current.get(throttleKey) ?? 0;
        if (Date.now() - lastCheckedAt < OAUTH_CHECK_THROTTLE_MS) {
          return;
        }
      }
      lastCheckAtRef.current.set(throttleKey, Date.now());
      inFlightRef.current.add(throttleKey);

      setOAuthStatus((prev) => ({
        ...prev,
        [server.id]: {
          isAuthenticated: prev[server.id]?.isAuthenticated ?? false,
          needsLogin: prev[server.id]?.needsLogin ?? false,
          isChecking: true,
        },
      }));

      try {
        const result = await mcpService.checkOAuthStatus.invoke({ server_url: serverUrl });
        const isAuthenticated = result.authenticated === true;

        setOAuthStatus((prev) => ({
          ...prev,
          [server.id]: {
            isAuthenticated,
            needsLogin: isAuthenticated ? false : (prev[server.id]?.needsLogin ?? false),
            isChecking: false,
          },
        }));
      } catch (error) {
        console.error('Failed to check OAuth status:', error);
        setOAuthStatus((prev) => ({
          ...prev,
          [server.id]: {
            isAuthenticated: false,
            needsLogin: false,
            isChecking: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        }));
      } finally {
        inFlightRef.current.delete(throttleKey);
      }
    },
    [getOAuthServerUrl]
  );

  // 执行 OAuth 登录
  const login = useCallback(
    async (server: IMcpServer): Promise<{ success: boolean; error?: string }> => {
      const serverUrl = getOAuthServerUrl(server);
      if (!serverUrl) {
        return {
          success: false,
          error: 'OAuth is only supported for URL-based MCP transports',
        };
      }

      setLoggingIn((prev) => ({ ...prev, [server.id]: true }));

      try {
        const result = await mcpService.loginMcpOAuth.invoke({ server_url: serverUrl });

        if (result.success) {
          // 登录成功，更新状态
          setOAuthStatus((prev) => ({
            ...prev,
            [server.id]: {
              isAuthenticated: true,
              needsLogin: false,
              isChecking: false,
            },
          }));
          return { success: true };
        } else {
          return {
            success: false,
            error: result.error || 'Login failed',
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      } finally {
        setLoggingIn((prev) => ({ ...prev, [server.id]: false }));
      }
    },
    [getOAuthServerUrl]
  );

  // 登出
  const logout = useCallback(
    async (server: IMcpServer): Promise<{ success: boolean; error?: string }> => {
      const serverUrl = getOAuthServerUrl(server);
      if (!serverUrl) {
        return {
          success: false,
          error: 'OAuth is only supported for URL-based MCP transports',
        };
      }

      try {
        await mcpService.logoutMcpOAuth.invoke({ server_url: serverUrl });

        // 登出成功，更新状态
        setOAuthStatus((prev) => ({
          ...prev,
          [server.id]: {
            isAuthenticated: false,
            needsLogin: false,
            isChecking: false,
          },
        }));
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    [getOAuthServerUrl]
  );

  // 批量检查多个服务器的 OAuth 状态（并发受限，避免同时打出几百个请求）
  const checkMultipleServers = useCallback(
    async (servers: IMcpServer[]) => {
      const httpServers = servers.filter((s) => getOAuthServerUrl(s));
      if (httpServers.length === 0) {
        return;
      }

      let cursor = 0;
      const workers = Array.from({ length: Math.min(OAUTH_CHECK_CONCURRENCY, httpServers.length) }, async () => {
        while (cursor < httpServers.length) {
          const server = httpServers[cursor++];
          await checkOAuthStatus(server);
        }
      });
      await Promise.all(workers);
    },
    [checkOAuthStatus, getOAuthServerUrl]
  );

  return {
    oauthStatus,
    loggingIn,
    checkOAuthStatus,
    checkMultipleServers,
    markLoginRequired: useCallback((serverId: string) => {
      setOAuthStatus((prev) => ({
        ...prev,
        [serverId]: {
          isAuthenticated: prev[serverId]?.isAuthenticated ?? false,
          needsLogin: true,
          isChecking: false,
        },
      }));
    }, []),
    clearLoginRequired: useCallback((serverId: string) => {
      setOAuthStatus((prev) => ({
        ...prev,
        [serverId]: {
          isAuthenticated: prev[serverId]?.isAuthenticated ?? false,
          needsLogin: false,
          isChecking: false,
        },
      }));
    }, []),
    login,
    logout,
  };
};
