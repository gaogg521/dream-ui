/**
 * Enterprise-org identity hook. Resolves the current user's own SSO company /
 * department / job title via /api/one/enterprise/me (one-enterprise crate),
 * INDEPENDENT of any project-group (tenant) membership.
 *
 * In client mode this governance path resolves on the remote server, so it
 * returns THIS member's identity (not the host operator's).
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { ORG_CONTEXT_CHANGED_EVENT } from '@renderer/pages/enterprise/hooks/useOrgContext';
import type { EnterpriseIdentity } from '@/common/types/org/orgTypes';

export type UseEnterpriseIdentityResult = {
  loading: boolean;
  identity: EnterpriseIdentity | null;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useEnterpriseIdentity(): UseEnterpriseIdentityResult {
  const [identity, setIdentity] = useState<EnterpriseIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipcBridge.oneEnterprise.me.invoke();
      setIdentity(result ?? null);
    } catch (e) {
      setIdentity(null);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch on the same membership-change signal the org context uses, so a
  // fresh SSO login (which also flips org context) refreshes this too.
  useEffect(() => {
    const handler = (): void => {
      void refresh();
    };
    window.addEventListener(ORG_CONTEXT_CHANGED_EVENT, handler);
    return () => window.removeEventListener(ORG_CONTEXT_CHANGED_EVENT, handler);
  }, [refresh]);

  return { loading, identity, error, refresh };
}
