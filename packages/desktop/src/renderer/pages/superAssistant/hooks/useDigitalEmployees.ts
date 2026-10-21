/**
 * Digital employee data hook — personal agents + their run history.
 *
 * Simplified from the 1one `useSuperAssistantData` (643 lines): drops the
 * enterprise domain (requirements/skills/mcp/rag/codeRepo/pipeline/team
 * runtime status), keeps only the personal-agent slice that the
 * one-employee crate backs.
 */

import { useCallback, useEffect, useState } from 'react';
import { ipcBridge } from '@/common';
import type { DigitalEmployeeRunRecord, PersonalAgent } from '@/common/types/employee/employeeTypes';

export type DigitalEmployeeWithRuns = PersonalAgent & {
  latestRun?: DigitalEmployeeRunRecord;
  recentRuns: DigitalEmployeeRunRecord[];
};

export type UseDigitalEmployeesResult = {
  loading: boolean;
  agents: DigitalEmployeeWithRuns[];
  refresh: () => Promise<void>;
};

export function useDigitalEmployees(enabled: boolean): UseDigitalEmployeesResult {
  const [agents, setAgents] = useState<DigitalEmployeeWithRuns[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setAgents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await ipcBridge.personalAgent.list.invoke();
      setAgents((list ?? []).map((agent): DigitalEmployeeWithRuns => ({ ...agent, recentRuns: [] })));
    } catch (error) {
      console.error('[useDigitalEmployees] refresh failed', error);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    let disposed = false;
    void refresh().catch(() => {
      if (!disposed) {
        setLoading(false);
      }
    });
    const onTeamSync = () => {
      void refresh();
    };
    window.addEventListener('one-team-employees-changed', onTeamSync);
    return () => {
      disposed = true;
      window.removeEventListener('one-team-employees-changed', onTeamSync);
    };
  }, [refresh]);

  return {
    loading,
    agents,
    refresh,
  };
}
