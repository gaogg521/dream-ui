/**
 * Copyright 2026 One Work
 */

import type { IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import { useModelProviderList, useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSavedModelStale, pickFallbackModel } from './staleModelFallback';

export type DreamEngineModelSelection = {
  current_model?: TProviderWithModel;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
  getDisplayModelName: (modelName?: string) => string;
};

export type UseDreamEngineModelSelectionOptions = {
  initialModel: TProviderWithModel | undefined;
  onSelectModel: (provider: IProvider, modelName: string) => Promise<boolean>;
  /** Enables switching a history conversation off a deleted model. */
  conversationId?: string;
  /** All conversations, newest first or not — used to find the model in current use. */
  recentConversations?: TChatConversation[];
};

export const useDreamEngineModelSelection = ({
  initialModel,
  onSelectModel,
  conversationId,
  recentConversations,
}: UseDreamEngineModelSelectionOptions): DreamEngineModelSelection => {
  const [current_model, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [initialModel?.id, initialModel?.use_model]);

  const { providers: allProviders, getAvailableModels, formatModelLabel } = useModelProviderList();

  // Dream Core does not support Google Auth — filter it out
  const providers = useMemo(
    () => allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth')),
    [allProviders]
  );

  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        use_model: modelName,
      } as TProviderWithModel;
      const ok = await onSelectModel(provider, modelName);
      if (ok) {
        setCurrentModel(selected);
      }
    },
    [onSelectModel]
  );

  // A history conversation whose provider (or model) was deleted would fail
  // every send with PROVIDER_NOT_FOUND. Telling the user to pick a model is a
  // chore with one obvious answer, so continue with the model they use now.
  // Decided only once the raw provider list has loaded — an empty list while
  // loading must not read as "everything was deleted".
  const { data: rawProviders } = useProvidersQuery();
  const recoveredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !Array.isArray(rawProviders)) return;
    if (!isSavedModelStale(current_model, rawProviders)) return;
    const attemptKey = `${conversationId}:${current_model?.id}:${current_model?.use_model}`;
    if (recoveredRef.current === attemptKey) return;
    recoveredRef.current = attemptKey;
    const fallback = pickFallbackModel({
      staleModel: current_model,
      providers,
      getAvailableModels,
      recentConversations: recentConversations ?? [],
      conversationId,
    });
    if (!fallback) return;
    console.info('[dream] saved model is gone; continuing with', fallback.id, fallback.use_model);
    void handleSelectModel(fallback as unknown as IProvider, fallback.use_model);
  }, [
    conversationId,
    current_model,
    getAvailableModels,
    handleSelectModel,
    providers,
    rawProviders,
    recentConversations,
  ]);

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(current_model, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [current_model, formatModelLabel]
  );

  return {
    current_model,
    providers,
    getAvailableModels,
    handleSelectModel,
    getDisplayModelName,
  };
};
