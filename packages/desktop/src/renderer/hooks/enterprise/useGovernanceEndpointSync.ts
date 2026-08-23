/**
 * Keep the main process told where governance requests should go, so the
 * built-in `search_team_knowledge` MCP tool queries the same backend the UI does.
 *
 * Why this exists: the enterprise server URL and bearer token live in renderer
 * localStorage, which the main process cannot read (see
 * `common/adapter/enterpriseMode.ts`). `/api/one/devops` is a governance path,
 * so in client mode the knowledge base is on the remote server — without this
 * sync the MCP tool would query the member's own empty local backend and the
 * agent would conclude the company has no knowledge base.
 *
 * ADDITIVE / standalone-safe: with no remote configured this pushes `null`,
 * which is exactly the local-backend default. Desktop-only — a browser WebUI
 * session has no main process to inform.
 */

import { useEffect } from 'react';
import { ipcBridge } from '@/common';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseRemoteActive,
} from '@/common/adapter/enterpriseMode';
import { isElectronDesktop } from '@renderer/utils/platform';

/**
 * localStorage has no change event within the same document, and the session can
 * be replaced by an SSO round-trip or cleared by a logout at any time. Polling
 * on a slow tick is far simpler than threading a callback through every writer,
 * and the push is a no-op when nothing changed.
 */
const POLL_INTERVAL_MS = 30 * 1000;

export function useGovernanceEndpointSync(): void {
  useEffect(() => {
    if (!isElectronDesktop()) return;

    let lastSerialized: string | null = null;
    let disposed = false;

    const push = () => {
      if (disposed) return;
      const session = getEnterpriseSession();
      const baseUrl = getEnterpriseServerUrl();
      const endpoint =
        isEnterpriseRemoteActive() && baseUrl && session?.token ? { baseUrl, token: session.token } : null;

      // Compare before sending so a steady state costs nothing, and so the
      // token is not shuttled across the IPC boundary on every tick.
      const serialized = endpoint ? JSON.stringify([endpoint.baseUrl, endpoint.token]) : '';
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;

      // This runs in a mount effect in the app shell, so anything thrown here
      // takes the whole Layout down with it. The bridge channel can legitimately
      // be absent — an older preload, or a host that wires only part of the
      // bridge — so it is probed rather than assumed. Absent simply means the
      // knowledge-base tool stays on the local backend, which is the correct
      // default anyway.
      const channel = ipcBridge.application.setGovernanceEndpoint;
      if (typeof channel?.invoke !== 'function') return;
      try {
        void Promise.resolve(channel.invoke(endpoint)).catch(() => {
          // Main process not ready yet; the next tick retries. Force a retry by
          // clearing the memo so the unchanged value is sent again.
          lastSerialized = null;
        });
      } catch {
        lastSerialized = null;
      }
    };

    push();
    const timer = window.setInterval(push, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
}
