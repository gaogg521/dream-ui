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
  totalAgentCount: number;
  activeRunCount: number;
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
      const withRuns = await Promise.all(
        (list ?? []).map(async (agent): Promise<DigitalEmployeeWithRuns> => {
          try {
            const runs = await ipcBridge.personalAgent.listRuns.invoke({ agentId: agent.id });
            return {
              ...agent,
              latestRun: runs?.[0],
              recentRuns: runs ?? [],
            };
          } catch {
            return { ...agent, recentRuns: [] };
          }
        })
      );
      setAgents(withRuns);
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
    return () => {
      disposed = true;
    };
  }, [refresh]);

  const activeRunCount = agents.reduce((sum, agent) => sum + (agent.latestRun?.status === 'running' ? 1 : 0), 0);

  return {
    loading,
    agents,
    totalAgentCount: agents.length,
    activeRunCount,
    refresh,
  };
}
