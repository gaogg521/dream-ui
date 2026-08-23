import { ipcBridge } from '@/common';
import { resolveLocaleKey } from '@/common/utils';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { reorderAssistantList } from '@/renderer/pages/settings/AssistantSettings/assistantUtils';
import { selectableAssistants } from '@/renderer/utils/model/assistantSelection';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { useAssistantOrder } from './useAssistantOrder';

// Fork: exported so `services/prefetchAssistantsList.ts` can warm the same
// cache entry before the assistants page mounts.
export const ASSISTANTS_LIST_SWR_KEY = 'assistants.list';

/**
 * Manages the assistant list: loading from backend, sorting, and tracking the
 * active selection. Uses SWR so revisits can show cached data immediately while
 * revalidating in the background.
 */
export const useAssistantList = () => {
  const { i18n } = useTranslation();
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const localeKey = resolveLocaleKey(i18n.language);
  const previousLocaleKeyRef = useRef(localeKey);
  const { assistantOrder, setAssistantOrder } = useAssistantOrder();

  const { data, isLoading, isValidating, mutate } = useSWR<Assistant[]>(
    ASSISTANTS_LIST_SWR_KEY,
    () => ipcBridge.assistants.list.invoke(),
    { revalidateOnFocus: false }
  );

  const assistants = data ?? [];
  const loading = isLoading || (isValidating && assistants.length === 0);

  const loadAssistants = useCallback(async () => {
    await mutate();
  }, [mutate]);

  useEffect(() => {
    if (assistants.length === 0) return;
    setActiveAssistantId((prev) => {
      if (prev && assistants.some((a) => a.id === prev)) return prev;
      return assistants[0]?.id ?? null;
    });
  }, [assistants]);

  const reorderEnabledAssistants = useCallback(
    async (activeId: string, overId: string) => {
      const enabledAssistants = selectableAssistants(assistants, assistantOrder);
      const reorderedAssistants = reorderAssistantList(enabledAssistants, activeId, overId);
      if (reorderedAssistants === enabledAssistants) return;

      try {
        await setAssistantOrder(reorderedAssistants.map((assistant) => assistant.id));
      } catch (error) {
        console.error('Failed to reorder enabled assistants:', error);
        throw error;
      }
    },
    [assistantOrder, assistants, setAssistantOrder]
  );

  useEffect(() => {
    const localeChanged = previousLocaleKeyRef.current !== localeKey;
    previousLocaleKeyRef.current = localeKey;

    if (!localeChanged) {
      return;
    }

    void loadAssistants();
  }, [loadAssistants, localeKey]);

  const activeAssistant = assistants.find((a) => a.id === activeAssistantId) ?? null;

  return {
    assistants,
    loading,
    setAssistants: async (next: Assistant[]) => {
      await mutate(next, { revalidate: false });
    },
    activeAssistantId,
    setActiveAssistantId,
    activeAssistant,
    loadAssistants,
    reorderEnabledAssistants,
    assistantOrder,
    setAssistantOrder,
    localeKey,
  };
};
