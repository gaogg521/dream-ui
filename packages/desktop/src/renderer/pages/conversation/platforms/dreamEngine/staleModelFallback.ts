/**
 * Copyright 2026 One Work
 */

import type { IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';

/**
 * Whether a conversation's saved model can still be resolved by the backend.
 *
 * Only the two cases the backend cannot recover from count as stale: the
 * provider row is gone (`PROVIDER_NOT_FOUND` on send), or the provider no longer
 * lists the model at all. A model the user merely toggled off is left alone —
 * that is a preference, not a broken binding.
 */
export const isSavedModelStale = (model: TProviderWithModel | undefined, allProviders: IProvider[]): boolean => {
  if (!model?.id || !model.use_model) return false;
  const provider = allProviders.find((item) => item.id === model.id);
  if (!provider) return true;
  return !(provider.models ?? []).includes(model.use_model);
};

const toSelection = (provider: IProvider, modelName: string): TProviderWithModel =>
  ({ ...(provider as unknown as TProviderWithModel), use_model: modelName }) as TProviderWithModel;

/**
 * The model a history conversation should continue with once its saved model
 * is gone, in order of how close it stays to what the user meant:
 *
 * 1. the same model name under another provider (the provider was re-added);
 * 2. the model of the user's most recently used dream conversation (what they
 *    are working with now);
 * 3. the first chat-capable model — the same default the welcome page picks.
 *
 * `providers` must already be the chat-capable list the picker offers.
 */
export const pickFallbackModel = ({
  staleModel,
  providers,
  getAvailableModels,
  recentConversations,
  conversationId,
}: {
  staleModel: TProviderWithModel | undefined;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  recentConversations: TChatConversation[];
  conversationId: string;
}): TProviderWithModel | undefined => {
  const offers = (providerId: string | undefined, modelName: string | undefined) => {
    const provider = providers.find((item) => item.id === providerId);
    return provider && modelName && getAvailableModels(provider).includes(modelName) ? provider : undefined;
  };

  const wanted = staleModel?.use_model;
  if (wanted) {
    const sameName = providers.find((provider) => getAvailableModels(provider).includes(wanted));
    if (sameName) return toSelection(sameName, wanted);
  }

  const recent = [...recentConversations]
    .filter((conversation) => conversation.type === 'dream' && conversation.id !== conversationId)
    .sort((a, b) => (b.modified_at ?? 0) - (a.modified_at ?? 0));
  for (const conversation of recent) {
    const model = (conversation as { model?: TProviderWithModel }).model;
    const provider = offers(model?.id, model?.use_model);
    if (provider && model?.use_model) return toSelection(provider, model.use_model);
  }

  const first = providers.find((provider) => getAvailableModels(provider).length > 0);
  const firstModel = first ? getAvailableModels(first)[0] : undefined;
  return first && firstModel ? toSelection(first, firstModel) : undefined;
};
