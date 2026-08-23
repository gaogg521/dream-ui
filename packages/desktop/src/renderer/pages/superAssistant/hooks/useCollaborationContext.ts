/**
 * Enterprise collaboration context — aggregates the one-devops registries
 * (skills / MCP / RAG documents) into the summary consumed by the issues
 * board. Port of the 1one useEnterpriseCollaborationContext hook on top of
 * the oneDevops bridge domain.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import type { McpRegistryEntry, RagDocumentEntry, SkillRegistryEntry } from '@/common/types/devops/devopsTypes';

export type CollaborationContext = {
  loading: boolean;
  ragDocumentCount: number;
  ragReady: boolean;
  skillCount: number;
  skillNames: string[];
  enabledMcpCount: number;
  mcpNames: string[];
};

const EMPTY_CONTEXT: CollaborationContext = {
  loading: false,
  ragDocumentCount: 0,
  ragReady: false,
  skillCount: 0,
  skillNames: [],
  enabledMcpCount: 0,
  mcpNames: [],
};

function buildContext(
  skills: SkillRegistryEntry[],
  mcpRegistry: McpRegistryEntry[],
  ragDocuments: RagDocumentEntry[]
): Omit<CollaborationContext, 'loading'> {
  const enabledSkills = skills.filter((skill) => skill.enabled);
  const enabledMcp = mcpRegistry.filter((entry) => entry.enabled);
  return {
    ragDocumentCount: ragDocuments.length,
    ragReady: ragDocuments.length > 0,
    skillCount: enabledSkills.length,
    skillNames: enabledSkills.slice(0, 3).map((skill) => skill.name),
    enabledMcpCount: enabledMcp.length,
    mcpNames: enabledMcp.slice(0, 3).map((entry) => entry.name),
  };
}

export function useCollaborationContext(enabled: boolean): CollaborationContext {
  const [skills, setSkills] = useState<SkillRegistryEntry[]>([]);
  const [mcpRegistry, setMcpRegistry] = useState<McpRegistryEntry[]>([]);
  const [ragDocuments, setRagDocuments] = useState<RagDocumentEntry[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setSkills([]);
      setMcpRegistry([]);
      setRagDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [skillsResult, mcpResult, ragResult] = await Promise.allSettled([
      ipcBridge.oneDevops.listSkills.invoke(),
      ipcBridge.oneDevops.listMcpRegistry.invoke(),
      ipcBridge.oneDevops.listRagDocuments.invoke(),
    ]);
    setSkills(skillsResult.status === 'fulfilled' ? (skillsResult.value ?? []) : []);
    setMcpRegistry(mcpResult.status === 'fulfilled' ? (mcpResult.value ?? []) : []);
    setRagDocuments(ragResult.status === 'fulfilled' ? (ragResult.value ?? []) : []);
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, [refresh]);

  return useMemo(() => {
    if (!enabled) {
      return EMPTY_CONTEXT;
    }
    return { ...buildContext(skills, mcpRegistry, ragDocuments), loading };
  }, [enabled, loading, mcpRegistry, ragDocuments, skills]);
}
