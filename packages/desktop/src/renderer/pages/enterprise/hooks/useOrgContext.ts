/**
 * Enterprise org context hook — resolves the current user's tenant, role
 * and enterprise flag via /api/one/org/context (one-org crate).
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { OrgContext } from '@/common/types/org/orgTypes';

/**
 * Broadcast whenever this member's org membership changes (join / create /
 * exit). Every `useOrgContext()` call site fetches independently on its own
 * mount with no shared cache — without this event, sibling instances (e.g.
 * the sidebar's `WorkspaceIdentityEntry` badge vs the settings page that
 * actually performed the join/exit) go stale until the next full reload,
 * showing the wrong tenant/edition after an action that visibly succeeded.
 */
export const ORG_CONTEXT_CHANGED_EVENT = 'one-org-context-changed';

export function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === 'org_admin' || role === 'system_admin';
}

export function isSystemAdminRole(role: string | null | undefined): boolean {
  return role === 'system_admin';
}

export type UseOrgContextResult = {
  loading: boolean;
  context: OrgContext | null;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useOrgContext(): UseOrgContextResult {
  const [context, setContext] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await ipcBridge.oneOrg.context.invoke();
      setContext(ctx ?? null);
    } catch (e) {
      setContext(null);
      setError(String(e));
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
    window.addEventListener(ORG_CONTEXT_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ORG_CONTEXT_CHANGED_EVENT, handler);
  }, [refresh]);

  return { loading, context, error, refresh };
}
