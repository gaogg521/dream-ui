/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IProvider,
  ModelImageInputCapability,
  ModelKind,
  ModelOpenAiApiMode,
  ModelSettings,
  ModelType,
} from '@/common/config/storage';
import {
  inferModelKindFromName,
  resolveDisplayModelKind,
  resolveMediaModelSpec,
  resolveModelKindLabel,
  type MediaProviderShape,
} from '@/common/media/catalog';

/**
 * Capability matching regex patterns
 */
export const CAPABILITY_PATTERNS: Record<ModelType, RegExp> = {
  text: /gpt|claude|gemini|qwen|llama|mistral|deepseek/i,
  vision: /4o|claude-3|gemini-.*-pro|gemini-.*-flash|gemini-2\.0|qwen-vl|llava|vision/i,
  function_calling: /gpt-4|claude-3|gemini|qwen|deepseek/i,
  image_generation: /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|imagen/i,
  web_search: /search|perplexity/i,
  reasoning: /o1-|reasoning|think/i,
  embedding: /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i,
  rerank: /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i,
  excludeFromPrimary: /dall-e|flux|stable-diffusion|midjourney|flash-image|image|embed|rerank/i,
};

/**
 * Explicit exclusion lists (blacklist) for capabilities
 */
export const CAPABILITY_EXCLUSIONS: Record<ModelType, RegExp[]> = {
  text: [],
  vision: [/embed|rerank|dall-e|flux|stable-diffusion/i],
  function_calling: [
    /aqa(?:-[\w-]+)?/i,
    /imagen(?:-[\w-]+)?/i,
    /o1-mini/i,
    /o1-preview/i,
    /gemini-1(?:\\.[\w-]+)?/i,
    /dall-e/i,
    /embed/i,
    /rerank/i,
  ],
  image_generation: [],
  web_search: [],
  reasoning: [],
  embedding: [],
  rerank: [],
  excludeFromPrimary: [],
};

/**
 * Get the lowercase, normalized base model name for matching.
 */
export const getBaseModelName = (modelName: string): string => {
  return modelName
    .toLowerCase()
    .replace(/[^a-z0-9./-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

export type ModelOpenAiApiModeChoice = ModelOpenAiApiMode | 'auto';
export type ModelImageInputChoice = ModelImageInputCapability | 'auto';

/** Whether a provider/model protocol can select an OpenAI wire API. */
export const supportsOpenAiApiMode = (platform: string, modelProtocol = 'openai'): boolean => {
  if (platform === 'new-api') return modelProtocol === 'openai';
  return !['anthropic', 'bedrock', 'gemini', 'gemini-vertex-ai'].includes(platform);
};

/** Apply explicit settings to models while keeping automatic values absent on the wire. */
export type ModelKindChoice = ModelKind | 'auto';

export const updateModelSettings = (
  current: Record<string, ModelSettings> | undefined,
  modelIds: string[],
  imageInput: ModelImageInputChoice,
  openAiApiMode: ModelOpenAiApiModeChoice,
  modelKind: ModelKindChoice = 'auto',
  mediaEndpoint = '',
  mediaUnitPriceUsd?: number,
  /**
   * Per-resolution prices, keyed by the tier string the model's spec offers.
   * Entries that are not positive finite numbers are dropped rather than
   * stored — a 0 would read as "this tier is free".
   */
  mediaUnitPricesUsd?: Record<string, number>
): Record<string, ModelSettings> => {
  const next = { ...current };
  const endpoint = mediaEndpoint.trim();
  // Only meaningful for models that produce media; carrying it on a text model
  // would leave a stale value behind if the kind is later changed.
  const keepEndpoint = endpoint && (modelKind === 'image' || modelKind === 'video');

  for (const modelId of modelIds) {
    const hasPrice =
      typeof mediaUnitPriceUsd === 'number' && Number.isFinite(mediaUnitPriceUsd) && mediaUnitPriceUsd > 0;
    const tierPrices = Object.fromEntries(
      Object.entries(mediaUnitPricesUsd ?? {}).filter(
        ([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0
      )
    );
    const hasTierPrices = Object.keys(tierPrices).length > 0;
    if (imageInput === 'auto' && openAiApiMode === 'auto' && modelKind === 'auto' && !hasPrice && !hasTierPrices) {
      delete next[modelId];
      continue;
    }

    const settings: ModelSettings = {};
    if (imageInput !== 'auto') settings.image_input = imageInput;
    if (openAiApiMode !== 'auto') settings.openai_api_mode = openAiApiMode;
    if (modelKind !== 'auto') settings.model_kind = modelKind;
    if (keepEndpoint) settings.media_endpoint = endpoint;
    // Price only makes sense for a media model; keeping it on a text model
    // would leave a stale figure behind after a kind change.
    if (hasPrice && (modelKind === 'image' || modelKind === 'video')) {
      settings.media_unit_price_usd = mediaUnitPriceUsd;
    }
    if (hasTierPrices && (modelKind === 'image' || modelKind === 'video')) {
      settings.media_unit_prices_usd = tierPrices;
    }
    next[modelId] = settings;
  }

  return next;
};

/**
 * The kind to show for this model on this provider.
 *
 * Delegates to the catalog so the label follows the same resolution order the
 * execution path uses — the user's declaration first, the built-in catalog
 * second. Undefined means neither source knows; nothing is inferred from the
 * name alone.
 */
export const declaredModelKindOf = (
  provider: Pick<IProvider, 'model_settings' | 'platform' | 'base_url'> | undefined,
  modelName: string | undefined
): ModelKind | undefined => {
  if (!provider || !modelName) return undefined;
  return resolveDisplayModelKind(provider as MediaProviderShape, modelName) as ModelKind | undefined;
};

/**
 * The kind for a model known only by name.
 *
 * Needed by the ACP selectors, whose model list comes from the CLI session
 * rather than from a provider, so there is no provider to look the setting up
 * on. Matching by name is a guess about identity, so it only answers when the
 * guess is unambiguous: if two providers resolve the same name to different
 * kinds, there is no way to tell which one the CLI means and a wrong label is
 * worse than none.
 */
/**
 * The kind to print next to a model name, and whether it was guessed.
 *
 * Separate from `declaredModelKindOf` on purpose: this one may fall through to
 * name patterns so that a 16-model list is legible at a glance, while the
 * authoritative helper above stays free of guesses because it decides what the
 * model is allowed to do.
 */
export const modelKindLabelOf = (
  provider: Pick<IProvider, 'model_settings' | 'platform' | 'base_url'> | undefined,
  modelName: string | undefined
): { kind?: ModelKind; inferred: boolean } => {
  if (!provider || !modelName) return { inferred: false };
  const { kind, inferred } = resolveModelKindLabel(provider as MediaProviderShape, modelName);
  return { kind: kind as ModelKind | undefined, inferred };
};

/**
 * Every model on a provider whose kind was guessed from its name.
 *
 * Backs the "accept the guessed kinds" action. Confirming a guess one model at
 * a time means a dialog per model, which nobody does for ten of them — so the
 * guesses stay guesses and everything downstream keeps treating those models as
 * undeclared. Accepting in bulk is only safe because the guess is never load
 * bearing until the user agrees to it, and each stays editable afterwards.
 *
 * Models already declared, resolved from the catalog, or unreadable are all
 * excluded: the first two are not guesses, and the third has nothing to accept.
 */
export const inferredModelKinds = (
  provider: Pick<IProvider, 'models' | 'model_settings' | 'platform' | 'base_url'> | undefined
): { model: string; kind: ModelKind }[] => {
  if (!provider?.models?.length) return [];
  const out: { model: string; kind: ModelKind }[] = [];
  for (const model of provider.models) {
    const { kind, inferred } = modelKindLabelOf(provider, model);
    if (inferred && kind) out.push({ model, kind });
  }
  return out;
};

export const declaredModelKindByName = (
  providers: ReadonlyArray<Pick<IProvider, 'model_settings' | 'platform' | 'base_url'>> | undefined,
  modelName: string | undefined
): ModelKind | undefined => {
  if (!modelName || !providers?.length) return undefined;
  let found: ModelKind | undefined;
  for (const provider of providers) {
    const kind = declaredModelKindOf(provider, modelName);
    if (!kind) continue;
    if (found && found !== kind) return undefined;
    found = kind;
  }
  return found;
};

/** Label counterpart of `declaredModelKindByName` — may fall through to a guess. */
export const modelKindLabelByName = (
  providers: ReadonlyArray<Pick<IProvider, 'model_settings' | 'platform' | 'base_url'>> | undefined,
  modelName: string | undefined
): { kind?: ModelKind; inferred: boolean } => {
  if (!modelName) return { inferred: false };
  const known = declaredModelKindByName(providers, modelName);
  if (known) return { kind: known, inferred: false };
  return { kind: inferModelKindFromName(modelName) as ModelKind | undefined, inferred: true };
};

/**
 * Can this model be picked for a conversation?
 *
 * Replaces the `excludeFromPrimary` name regex for this decision. That regex
 * matched on the model *name* (`/image|dall-e|flux|.../`) and got it wrong in
 * both directions on a real library: it hid `gemini-3-pro-image`, which is a
 * chat model that happens to answer with pictures, while happily offering
 * `seedance-2-0-pro`, which has no chat endpoint at all and answers a message
 * with `404 model not found`.
 *
 * The kind is resolved the same way everything else resolves it — the user's
 * declaration, then the built-in catalog, which matches on provider *and*
 * model. Unknown means shown: hiding a model we have not identified is the
 * "new model needs a code change before it works" failure this design set out
 * to remove.
 */
export const isChatCapableModel = (
  provider: Pick<IProvider, 'model_settings' | 'platform' | 'base_url'>,
  modelName: string
): boolean => {
  const kind = declaredModelKindOf(provider, modelName);
  if (kind === 'video' || kind === 'audio') return false;
  if (kind === 'image') {
    // Form B *is* a chat call — the picture comes back in the reply, so the
    // model belongs in the conversation picker. Form A and C are dedicated
    // generation endpoints that no chat request can reach.
    const spec = resolveMediaModelSpec('image', provider as MediaProviderShape, modelName);
    return spec?.form === 'B';
  }
  return true;
};

/**
 * Check whether a specific model within a provider has a given capability.
 * Returns true (supported), false (excluded), or undefined (unknown).
 */
export const hasSpecificModelCapability = (
  _platformModel: IProvider,
  modelName: string,
  type: ModelType
): boolean | undefined => {
  const baseModelName = getBaseModelName(modelName);
  const exclusions = CAPABILITY_EXCLUSIONS[type];
  const pattern = CAPABILITY_PATTERNS[type];

  const isExcluded = exclusions.some((excludePattern) => excludePattern.test(baseModelName));
  if (isExcluded) return false;

  return pattern.test(baseModelName) ? true : undefined;
};
