import { useCallback, useMemo } from 'react';
import { ipcBridge } from '@/common';
import { resolveLocaleKey } from '@/common/utils';
import { useConversationAssistants } from '@renderer/pages/conversation/hooks/useConversationAssistants';
import { useMarketplacePersonas } from '@renderer/hooks/assistant/useMarketplacePersonas';
import { refreshManagedAgentCatalogAndAssistants } from '@renderer/hooks/agent/useManagedAgents';
import {
  assistantToOption,
  buildTeamMemberCatalog,
  filterTeamSupportedAssistants,
  matchesAssistantQuery,
  type TeamAssistantOption,
} from '../components/assistantSelectUtils';

export function useTeamAssistantOptions(locale = 'en-US'): {
  /** Full staffing catalog: agents first, then experts (adopted and not yet adopted). */
  assistants: TeamAssistantOption[];
  loading: boolean;
  error: unknown;
  filterByQuery: (query: string) => TeamAssistantOption[];
  /** Make a not-yet-adopted expert usable (enable an official template, or install a
   * marketplace persona) and return it as a selectable option. */
  adoptAssistant: (assistantId: string) => Promise<TeamAssistantOption>;
} {
  const result = useConversationAssistants() as {
    presetAssistants?: Parameters<typeof assistantToOption>[0][];
    allAssistants?: Parameters<typeof assistantToOption>[0][];
    loading?: boolean;
    isLoading?: boolean;
    error?: unknown;
    refresh?: () => Promise<void>;
  };
  const { personas: marketplacePersonas, install } = useMarketplacePersonas();
  const localeKey = resolveLocaleKey(locale);
  const assistants = useMemo(
    () =>
      filterTeamSupportedAssistants(
        buildTeamMemberCatalog({
          selectable: result.presetAssistants ?? [],
          all: result.allAssistants ?? [],
          marketplacePersonas,
          localeKey,
        })
      ),
    [result.presetAssistants, result.allAssistants, marketplacePersonas, localeKey]
  );
  const filterByQuery = useMemo(
    () => (query: string) => assistants.filter((assistant) => matchesAssistantQuery(assistant, query)),
    [assistants]
  );

  const allAssistants = result.allAssistants;
  const refresh = result.refresh;
  const adoptAssistant = useCallback(
    async (assistantId: string) => {
      const existing = allAssistants?.find((assistant) => assistant.id === assistantId);
      const adopted = existing
        ? existing.enabled === false
          ? await ipcBridge.assistants.setState.invoke({ id: assistantId, enabled: true })
          : existing
        : await install(assistantId);
      void refreshManagedAgentCatalogAndAssistants();
      void refresh?.();
      return { ...assistantToOption(adopted, localeKey), group: 'expert' as const };
    },
    [allAssistants, install, localeKey, refresh]
  );

  return {
    assistants,
    loading: Boolean(result.loading ?? result.isLoading),
    error: result.error,
    filterByQuery,
    adoptAssistant,
  };
}
