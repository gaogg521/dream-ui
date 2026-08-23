/**
 * Company-tier (真实企业) hook — the deployment's company as seen by the caller
 * (Direction B: the governance tier ABOVE project groups), via
 * /api/one/enterprise/company. `company` is null when no company exists on this
 * server (personal / standalone edition never sets one up).
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import { ORG_CONTEXT_CHANGED_EVENT } from '@renderer/pages/enterprise/hooks/useOrgContext';
import type { CompanyOverview } from '@/common/types/org/orgTypes';

export type UseCompanyIdentityResult = {
  loading: boolean;
  company: CompanyOverview | null;
  isCompanyAdmin: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useCompanyIdentity(): UseCompanyIdentityResult {
  const [company, setCompany] = useState<CompanyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipcBridge.oneEnterprise.company.invoke();
      setCompany(result ?? null);
    } catch (e) {
      setCompany(null);
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

  return {
    loading,
    company,
    isCompanyAdmin: company?.viewerRole === 'admin',
    error,
    refresh,
  };
}
