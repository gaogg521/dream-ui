/**
 * Copyright 2026 One Work
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { getAvailableModels, hasAvailableModels } from '../utils/modelUtils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Build a unique key for a provider/model pair.
 */
const buildModelKey = (providerId?: string, modelName?: string) => {
  if (!providerId || !modelName) return null;
  return `${providerId}:${modelName}`;
};

/**
 * Is this selection still one the picker would offer?
 *
 * Deliberately `getAvailableModels` and not `provider.models`: the raw list
 * includes models that cannot hold a conversation at all (a video or image
 * endpoint answers a chat request with `404 model not found`). Checking the raw
 * list let a stale selection of such a model survive, so the welcome page could
 * sit there naming a video model as the chat model — with no hint that pressing
 * Enter would fail, and no way to tell whether it would chat or generate.
 *
 * The rule this restores: what is *selected* comes from the same list as what is
 * *offered*. Those two diverging is indistinguishable from a bug to the user.
 */
const isModelKeyAvailable = (key: string | null, providers?: IProvider[]) => {
  if (!key || !providers || providers.length === 0) return false;
  return providers.some((provider) => {
    if (!provider.id) return false;
    return getAvailableModels(provider).some((modelName) => buildModelKey(provider.id, modelName) === key);
  });
};

/** localStorage key of the model the person last picked by hand on the welcome page. */
const LAST_PICKED_MODEL_STORAGE_KEY = 'guid.lastPickedModelKey';

const readLastPickedModelKey = (): string | null => {
  try {
    return localStorage.getItem(LAST_PICKED_MODEL_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeLastPickedModelKey = (key: string) => {
  try {
    localStorage.setItem(LAST_PICKED_MODEL_STORAGE_KEY, key);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the pick just isn't remembered.
  }
};

/**
 * The model the welcome page starts on when nobody has chosen one: the model the person
 * last picked by hand if it is still offered, otherwise the first model the picker offers.
 *
 * It is a pure function of the offered list and that remembered pick. It used to be "the
 * first one at the moment the page mounted", which depended on how far the provider list
 * had loaded by then and which mount of the page you were looking at — so the same app
 * could start a chat on `my-personal-model` from one entry point and on `openrouter/free`
 * from another.
 */
const resolveDefaultModel = (
  providers: IProvider[],
  preferredKey: string | null
): { provider: IProvider; modelName: string; key: string } | null => {
  if (preferredKey) {
    for (const provider of providers) {
      for (const modelName of getAvailableModels(provider)) {
        const key = buildModelKey(provider.id, modelName);
        if (key === preferredKey) return { provider, modelName, key };
      }
    }
  }
  for (const provider of providers) {
    const modelName = getAvailableModels(provider)[0];
    const key = buildModelKey(provider.id, modelName);
    if (modelName && key) return { provider, modelName, key };
  }
  return null;
};

/** Provider-based agent keys that share the model list UI */
type ProviderAgentKey = 'dream';

export type GuidModelSelectionResult = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  formatGeminiModelLabel: (provider: { platform?: string } | undefined, modelName?: string) => string;
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model_info: TProviderWithModel, options?: { persistPreference?: boolean }) => Promise<void>;
  resetCurrentModel: (options?: { persistPreference?: boolean }) => Promise<void>;
};

/**
 * Hook that manages the provider-backed model selection state for the Guid page.
 * Assistant-driven defaults are applied by the caller; this hook only owns the
 * transient in-page selection.
 * @param agentKey - current provider-based agent (currently only 'dream')
 */
export const useGuidModelSelection = (agentKey: ProviderAgentKey = 'dream'): GuidModelSelectionResult => {
  const { isGoogleAuth } = useGoogleAuthModels();
  const { data: modelConfig } = useProvidersQuery();

  const modelList = useMemo(() => {
    const allProviders: IProvider[] = (modelConfig || []).filter((platform) => !!platform.models.length);
    return allProviders.filter(hasAvailableModels);
  }, [modelConfig]);

  const formatGeminiModelLabel = useCallback((_provider: { platform?: string } | undefined, modelName?: string) => {
    if (!modelName) return '';
    return modelName;
  }, []);

  const [current_model, _setCurrentModel] = useState<TProviderWithModel>();
  const selectedModelKeyRef = useRef<string | null>(null);
  // The key this hook chose by itself. While the selection still equals it, nobody has
  // taken the choice over, so it keeps following the default as the provider list settles.
  const autoDefaultKeyRef = useRef<string | null>(null);

  const setCurrentModel = useCallback(
    async (model_info: TProviderWithModel, options?: { persistPreference?: boolean }) => {
      const key = buildModelKey(model_info.id, model_info.use_model);
      selectedModelKeyRef.current = key;
      // A choice made by the caller (a hand pick, or an assistant's own default) is no longer ours to move.
      autoDefaultKeyRef.current = null;
      // Only a hand pick on the plain welcome page is remembered; an assistant's default must not
      // become the default for everything else.
      if (options?.persistPreference === true && key) writeLastPickedModelKey(key);
      _setCurrentModel(model_info);
    },
    []
  );

  const resetCurrentModel = useCallback(
    async (_options?: { persistPreference?: boolean }) => {
      if (!modelList || modelList.length === 0) {
        return;
      }

      selectedModelKeyRef.current = null;

      // Same list the picker offers, for the same reason as above: `models[0]`
      // is whatever the provider happens to list first, which can be an image
      // or video endpoint. Falling back onto one of those replaces a broken
      // selection with another broken selection.
      const resolved = resolveDefaultModel(modelList, readLastPickedModelKey());
      if (!resolved) return;

      // Not `setCurrentModel`: this is the hook's own pick, so it must stay "automatic"
      // and must not be written down as something the person chose.
      selectedModelKeyRef.current = resolved.key;
      autoDefaultKeyRef.current = resolved.key;
      _setCurrentModel({ ...resolved.provider, use_model: resolved.modelName });
    },
    [modelList]
  );

  // Set default model when modelList or agent changes
  useEffect(() => {
    const setDefaultModel = async () => {
      if (!modelList || modelList.length === 0) {
        return;
      }
      const currentKey = selectedModelKeyRef.current || buildModelKey(current_model?.id, current_model?.use_model);
      if (isModelKeyAvailable(currentKey, modelList)) {
        if (!selectedModelKeyRef.current && currentKey) {
          selectedModelKeyRef.current = currentKey;
        }
        // Still the automatic default: follow it if the list settled differently than when it was
        // chosen (the first load can hold only some of the providers).
        if (currentKey === autoDefaultKeyRef.current) {
          const wanted = resolveDefaultModel(modelList, readLastPickedModelKey());
          if (wanted && wanted.key !== currentKey) await resetCurrentModel();
        }
        return;
      }
      await resetCurrentModel();
    };

    setDefaultModel().catch((error) => {
      console.error('Failed to set default model:', error);
    });
  }, [agentKey, current_model?.id, current_model?.use_model, modelList, resetCurrentModel]);
  return {
    modelList,
    isGoogleAuth,
    formatGeminiModelLabel,
    current_model,
    setCurrentModel,
    resetCurrentModel,
  };
};
