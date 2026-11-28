/**
 * Copyright 2026 One Work
 */

import type { IProvider } from '@/common/config/storage';
import { isChatCapableModel } from '@/common/utils/modelCapabilities';
import { hasSpecificModelCapability } from '@/renderer/utils/model/modelCapabilities';

export type BridgeBackend = 'claude' | 'codex';

export type BridgeCandidate = { provider: IProvider; model: string };

/** Platforms whose wire protocol is fixed, whatever a per-model entry says. */
const NON_ANTHROPIC_PLATFORMS = new Set(['bedrock', 'gemini', 'openai', 'gemini-vertex-ai', 'ollama']);

/**
 * Whether Claude Code can talk to this model. The bridge hands it the saved
 * base URL and key as they are, so the endpoint itself has to speak the
 * Anthropic protocol, and a full request URL cannot be used as a base.
 */
const speaksAnthropic = (provider: IProvider, model: string): boolean => {
  if (provider.is_full_url) return false;
  if (provider.platform === 'anthropic') return true;
  return !NON_ANTHROPIC_PLATFORMS.has(provider.platform) && provider.model_protocols?.[model] === 'anthropic';
};

const chatModels = (provider: IProvider): string[] =>
  (provider.models ?? []).filter(
    (model) =>
      provider.model_enabled?.[model] !== false &&
      hasSpecificModelCapability(provider, model, 'function_calling') !== false &&
      isChatCapableModel(provider, model)
  );

/**
 * The saved models a bridge could use, at most one per provider so that one bad
 * key does not use up every attempt. The user's current chat model goes first.
 */
export const listBridgeCandidates = (
  backend: BridgeBackend,
  providers: IProvider[],
  preferred?: { providerId?: string; model?: string }
): BridgeCandidate[] => {
  const candidates = providers
    .filter((provider) => provider.enabled !== false)
    .flatMap((provider) => {
      const usable = chatModels(provider).filter((model) => backend === 'codex' || speaksAnthropic(provider, model));
      const model = usable.find((name) => provider.id === preferred?.providerId && name === preferred.model);
      const chosen = model ?? usable[0];
      return chosen ? [{ provider, model: chosen }] : [];
    });

  return candidates.toSorted(
    (a, b) => Number(b.provider.id === preferred?.providerId) - Number(a.provider.id === preferred?.providerId)
  );
};
