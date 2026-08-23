/**
 * "My project groups" hook (Phase 2 multi-membership) — lists every project
 * group the current user belongs to via /api/one/org/my-tenants, with which
 * one is active. Refreshes on the same ORG_CONTEXT_CHANGED_EVENT that
 * `useOrgContext` listens to, so joining / switching / leaving keeps the badge
 * switcher and the resolved context in sync.
 *
 * Personal / standalone edition has no memberships, so this resolves to an
 * empty list and the switcher never renders.
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { MyTenant } from '@/common/types/org/orgTypes';
import { ORG_CONTEXT_CHANGED_EVENT } from './useOrgContext';

export type UseMyTenantsResult = {
  loading: boolean;
  tenants: MyTenant[];
  error: string | null;
  refresh: () => Promise<void>;
};

export function useMyTenants(): UseMyTenantsResult {
  const [tenants, setTenants] = useState<MyTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ipcBridge.oneOrg.myTenants.invoke();
      setTenants(list ?? []);
    } catch (e) {
      setTenants([]);
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

  return { loading, tenants, error, refresh };
}
