/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { MarketplacePersona } from '@/common/types/agent/assistantTypes';
import { useCallback } from 'react';
import useSWR from 'swr';

export const MARKETPLACE_PERSONAS_SWR_KEY = 'assistants.marketplace.list';

/**
 * Browsable expert-marketplace catalog. Entirely separate from
 * `useAssistantList` — browsing/searching this never touches the caller's
 * own assistant list, only `install()` does (see `assistants.marketplace.install`).
 */
export const useMarketplacePersonas = () => {
  const { data, isLoading, isValidating, mutate } = useSWR<MarketplacePersona[]>(
    MARKETPLACE_PERSONAS_SWR_KEY,
    () => ipcBridge.assistants.marketplace.list.invoke(),
    { revalidateOnFocus: false }
  );

  const personas = data ?? [];
  const loading = isLoading || (isValidating && personas.length === 0);

  const install = useCallback(
    async (id: string) => {
      const installed = await ipcBridge.assistants.marketplace.install.invoke({ id });
      await mutate();
      return installed;
    },
    [mutate]
  );

  return {
    personas,
    loading,
    install,
    reloadMarketplace: useCallback(async () => {
      await mutate();
    }, [mutate]),
  };
};
