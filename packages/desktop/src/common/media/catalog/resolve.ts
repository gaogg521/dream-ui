/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Catalog resolution: provider + model → MediaModelSpec, plus parameter
 * clipping. Renderer-safe (no Node.js imports).
 */

import type { MediaGenParams } from '../types';
import type { CatalogApiForm, CatalogMediaKind, MediaModelMatch, MediaModelSpec } from './types';
import { ARK_SEEDREAM_CATALOG_ID, BUILTIN_IMAGE_MODELS } from './imageModels';
import { BUILTIN_VIDEO_MODELS } from './videoModels';
import { getUserMediaModelSpecs } from './userSpecs';
import { diagnoseEndpointMismatch, type EndpointMismatchDiagnosis } from './endpointStyleInfo';

/**
 * Provider fields needed for matching. Kept structural (not IProvider) so both
 * renderer provider objects and the MCP server's env-reconstructed provider
 * satisfy it.
 */
export type MediaProviderShape = {
  platform?: string;
  base_url?: string;
  name?: string;
  /**
   * Per-model declarations the user made in model settings. Read here rather
   * than threaded through every call site, because every caller already passes
   * a full provider object.
   */
  model_settings?: Record<string, { model_kind?: string; media_endpoint?: string } | undefined>;
};

/**
 * API forms executable in the current build.
 * A + B are synchronous; C is submit-and-poll, driven by the media job engine
 * (process/services/mediaJob) so it survives tool-call timeouts and restarts.
 * The settings dropdown and the allowlist both gate on this, so users are
 * never offered a model the runtime cannot actually drive.
 */
export const EXECUTABLE_FORMS: readonly CatalogApiForm[] = ['A', 'B', 'C'];

/**
 * Form C endpoint styles that actually have a driver implemented.
 *
 * A catalog entry can describe a vendor before its driver exists (the video
 * entries were written that way on purpose), so the form alone is not enough to
 * decide "we can run this" — without this check the picker would offer Kling or
 * Sora and only fail at call time.
 *
 * MUST match the ids registered in `adapters/taskDrivers`. Kept here as data
 * rather than imported so the catalog stays free of adapter dependencies; a
 * test asserts the two lists agree.
 */
export const IMPLEMENTED_ENDPOINT_STYLES: readonly string[] = [
  'dashscope-task',
  'ark-task',
  'seedance-gateway',
  'openai-video',
  'cogvideox',
  'kling',
  'agnes-task',
];

/**
 * Endpoint styles that are synchronous, and so stay on Form A.
 *
 * `media_endpoint` reads as "which protocol does this model speak", and not
 * every non-standard protocol is an async task API. Seedream behind a gateway
 * answers in one round trip but under its own path and with the reference image
 * inline, so it needs its own style without becoming a Form C job.
 *
 * Checked before the async list: a style named here must never be turned into a
 * polling job, which would wait forever for a task id that is never issued.
 */
export const SYNC_IMAGE_ENDPOINT_STYLES: readonly string[] = ['seedream-gateway'];

/** Platforms whose SDK is not OpenAI-compatible — generic Form A entries must not fire on them. */
const NON_OPENAI_COMPATIBLE_PLATFORMS = new Set(['anthropic', 'bedrock', 'gemini', 'gemini-vertex-ai']);

/**
 * Hosts that serve image/video models over their own native protocol rather
 * than the OpenAI images API — Stability's `/v2beta/stable-image` multipart
 * endpoints, Replicate/fal/BFL submit-and-poll queues, and so on.
 *
 * A model name alone cannot tell these apart from the same model served by an
 * OpenAI-compatible gateway (`stable-diffusion-3-5-large` is offered by both
 * SiliconFlow and Stability directly), so generic model-name entries are
 * suppressed here. Without this the picker would offer models that are
 * guaranteed to fail at call time — the exact "selectable but not executable"
 * drift the catalog exists to prevent.
 *
 * These are not permanently unsupported: when a native driver lands (phase 2+),
 * the host gets a real catalog entry with its own `endpointStyle`, and a
 * provider-pinned entry always wins over this suppression.
 */
const NATIVE_PROTOCOL_HOST_MARKERS = [
  'api.stability.ai',
  'api.replicate.com',
  'fal.run',
  'api.bfl.ai',
  'api.bfl.ml',
  'cloud.leonardo.ai',
  'api.midjourney.com',
];

const includesIgnoreCase = (haystack: string | undefined, needles: string[]): boolean => {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
};

const modelMatches = (condition: MediaModelMatch['model'], modelName: string): boolean => {
  if (condition instanceof RegExp) return condition.test(modelName);
  if (Array.isArray(condition)) return condition.some((name) => name.toLowerCase() === modelName.toLowerCase());
  return condition.toLowerCase() === modelName.toLowerCase();
};

const matchesEntry = (spec: MediaModelSpec, provider: MediaProviderShape, modelName: string): boolean => {
  const { match } = spec;
  if (!modelMatches(match.model, modelName)) return false;
  if (match.platform && !match.platform.some((p) => p.toLowerCase() === (provider.platform || '').toLowerCase())) {
    return false;
  }
  if (match.baseUrlIncludes && !includesIgnoreCase(provider.base_url, match.baseUrlIncludes)) return false;
  if (match.providerNameIncludes && !includesIgnoreCase(provider.name, match.providerNameIncludes)) return false;

  // An entry that pinned the provider (platform / base_url / provider name)
  // was written for that provider specifically, so it is trusted as-is.
  // Everything below only guards entries matched by model name alone.
  const isProviderPinned = !!(match.platform || match.baseUrlIncludes || match.providerNameIncludes);
  if (isProviderPinned) return true;

  const requireOpenAi = match.requireOpenAiCompatible ?? spec.form === 'A';
  if (requireOpenAi && NON_OPENAI_COMPATIBLE_PLATFORMS.has((provider.platform || '').toLowerCase())) {
    return false;
  }
  if (includesIgnoreCase(provider.base_url, NATIVE_PROTOCOL_HOST_MARKERS)) {
    return false;
  }
  return true;
};

/**
 * Entries to consider for a kind, user overrides first.
 *
 * User entries win because that is the point of the escape hatch: a gateway
 * serving a model under different rules than its vendor must be able to say so
 * and be believed. They are validated on the way in (`overrides.ts`), including
 * the no-driver-no-offer rule, so this precedence cannot smuggle an
 * unexecutable model into the picker.
 */
const catalogFor = (kind: CatalogMediaKind): MediaModelSpec[] => {
  const builtins = kind === 'image' ? BUILTIN_IMAGE_MODELS : BUILTIN_VIDEO_MODELS;
  const overrides = getUserMediaModelSpecs().filter((spec) => spec.kind === kind);
  if (overrides.length === 0) return builtins;
  // Same id replaces its built-in rather than shadowing it, so a user entry
  // never leaves a stale duplicate sitting behind it.
  const overriddenIds = new Set(overrides.map((spec) => spec.id));
  return [...overrides, ...builtins.filter((spec) => !overriddenIds.has(spec.id))];
};

/** What the user declared this model produces, if anything. */
export const declaredModelKind = (provider: MediaProviderShape, modelName: string): string | undefined =>
  provider.model_settings?.[modelName]?.model_kind;

/**
 * A spec for a model the user declared but the catalog has never heard of.
 *
 * This is what keeps model coverage from being a whitelist: image and video
 * models ship constantly, and requiring a catalog entry (or a code change) for
 * each one means every new model is unusable until we cut a release. The user
 * already knows what they added.
 *
 * Images default to Form A — the OpenAI images API is the de-facto shape on
 * every compatible gateway. Video has no such default: it is always a
 * submit-and-poll API and the vendors disagree on the wire, so an undeclared
 * endpoint style is left unresolved rather than guessed, and the user picks one
 * in model settings. Guessing there would recreate the "selectable but never
 * callable" failure this whole layer exists to prevent.
 */
const specFromDeclaration = (
  kind: CatalogMediaKind,
  provider: MediaProviderShape,
  modelName: string
): MediaModelSpec | null => {
  const settings = provider.model_settings?.[modelName];
  if (settings?.model_kind !== kind) return null;

  const endpointStyle = settings.media_endpoint?.trim();
  if (kind === 'video') {
    if (!endpointStyle || !IMPLEMENTED_ENDPOINT_STYLES.includes(endpointStyle)) return null;
    return {
      id: `declared:${modelName}`,
      kind,
      form: 'C',
      endpointStyle,
      match: { model: modelName },
      params: {
        durations: undefined,
        resolutions: undefined,
        imageToVideo: true,
        seed: true,
        negativePrompt: true,
      },
      polling: { intervalMs: 5000, timeoutMs: 600_000 },
    };
  }

  /**
   * A synchronous style stays on Form A but carries its style through, so the
   * adapter knows to use that protocol's route and its own way of taking a
   * reference image. Checked first: these must not fall into the async branch.
   */
  if (endpointStyle && SYNC_IMAGE_ENDPOINT_STYLES.includes(endpointStyle)) {
    return {
      id: `declared:${modelName}`,
      kind,
      form: 'A',
      endpointStyle,
      match: { model: modelName },
      // One image per request, measured. Several come from repeated requests.
      params: { maxN: 1, seed: true, imageInput: true, sizes: ['1K', '2K', '4K'] },
    };
  }

  // An explicitly chosen async style wins over the Form A default.
  if (endpointStyle && IMPLEMENTED_ENDPOINT_STYLES.includes(endpointStyle)) {
    return {
      id: `declared:${modelName}`,
      kind,
      form: 'C',
      endpointStyle,
      match: { model: modelName },
      params: { seed: true, negativePrompt: true, maxN: 4 },
      polling: { intervalMs: 3000, timeoutMs: 300_000 },
    };
  }

  return {
    id: `declared:${modelName}`,
    kind,
    form: 'A',
    match: { model: modelName },
    params: { maxN: 4, seed: true, imageInput: true },
  };
};

/**
 * Resolve provider+model to a catalog spec. First match wins (catalog order is
 * priority order). Returns null when nothing matches.
 *
 * A user declaration outranks the built-in catalog: they are describing the
 * model in front of them, we are pattern-matching a name.
 */
export const resolveMediaModelSpec = (
  kind: CatalogMediaKind,
  provider: MediaProviderShape,
  modelName: string
): MediaModelSpec | null => {
  if (!modelName) return null;

  const declared = declaredModelKind(provider, modelName);
  if (declared && declared !== kind) {
    // Declared as something else entirely (a text model, say). Trust that over
    // any name pattern — this is how a model called "gemini-3-pro-image" that
    // the user uses for chat stops showing up in the image picker.
    return null;
  }

  const fromCatalog = catalogFor(kind).find((spec) => matchesEntry(spec, provider, modelName)) || null;
  if (fromCatalog) {
    // Honour an explicit endpoint choice even when the catalog matched.
    const chosen = provider.model_settings?.[modelName]?.media_endpoint?.trim();
    /**
     * A synchronous style has to be handled before the async one, and must not
     * be forced onto Form C. It also replaces the matched entry's parameters
     * rather than inheriting them: the built-in seedream entry describes Ark's
     * direct API, whose pixel sizes this gateway does not accept, and offering
     * `1024x1024` here would be offering a value the endpoint rejects.
     */
    if (chosen && SYNC_IMAGE_ENDPOINT_STYLES.includes(chosen)) {
      return {
        ...fromCatalog,
        endpointStyle: chosen,
        form: 'A',
        polling: undefined,
        params: { maxN: 1, seed: true, imageInput: true, sizes: ['1K', '2K', '4K'] },
      };
    }
    if (chosen && chosen !== fromCatalog.endpointStyle && IMPLEMENTED_ENDPOINT_STYLES.includes(chosen)) {
      return { ...fromCatalog, endpointStyle: chosen, form: 'C' };
    }
    return fromCatalog;
  }

  return specFromDeclaration(kind, provider, modelName);
};

/**
 * The kind to *show* next to a model name, as opposed to the kind that decides
 * what the model can do.
 *
 * Resolution order deliberately mirrors `resolveMediaModelSpec`: the user's own
 * declaration first, then the built-in catalog. Falling back to the catalog is
 * not the name-matching whitelist that was removed — the catalog is the same
 * data-driven table the execution path already consults, and it matches on
 * provider *and* model, so `stable-diffusion` behind a compatible gateway and
 * the same name on Stability's native API do not resolve alike.
 *
 * Returns undefined when neither source knows. That is a real answer, not a
 * gap: showing a guessed label is worse than showing none, and the settings
 * list surfaces the unknowns so they can be declared in one click.
 */
export const resolveDisplayModelKind = (provider: MediaProviderShape, modelName: string): string | undefined => {
  if (!modelName) return undefined;

  const declared = declaredModelKind(provider, modelName);
  if (declared) return declared;

  // Only image and video live in the catalog; text/audio/multimodal have no
  // entries and stay unknown until declared.
  if (resolveMediaModelSpec('image', provider, modelName)) return 'image';
  if (resolveMediaModelSpec('video', provider, modelName)) return 'video';
  return undefined;
};

/**
 * Name patterns used *only* to label a model, never to decide what it can do.
 *
 * This is the line that matters. The whitelist removed on 2026-08-06 was a
 * name regex that **gated** capability: a model the pattern missed could not
 * be used at all until someone shipped a code change. Guessing a *label* is a
 * different trade: the worst case is a wrong word next to a model name, which
 * the user can see and correct in one click, and nothing about what the model
 * can do changes. `isChatCapableModel` and `resolveMediaModelSpec` must keep
 * using `resolveDisplayModelKind` (declaration + catalog only) — routing a
 * request on a name guess is what produces "selectable but never callable".
 */
const NAME_HINTS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  { kind: 'video', pattern: /(^|[-_])(video|sora|veo|kling|seedance|cogvideo|wanx-video|runway|pika)/i },
  { kind: 'audio', pattern: /(^|[-_])(audio|tts|whisper|speech|voice|realtime|asr)/i },
  { kind: 'image', pattern: /(image|dall-?e|flux|diffusion|seedream|cogview|imagen|midjourney|^mj-|stable-?image)/i },
  { kind: 'multimodal', pattern: /(^|[-_])(vl|vision|omni|multimodal)([-_]|$)/i },
];

/** Names that are neither chat nor media, so no kind in our vocabulary fits. */
const NOT_A_KIND = /(embed|rerank|re-rank|moderation|guard)/i;

/**
 * A best-effort kind from the model name alone. Display only — see NAME_HINTS.
 */
export const inferModelKindFromName = (modelName: string): string | undefined => {
  if (!modelName) return undefined;
  if (NOT_A_KIND.test(modelName)) return undefined;
  for (const hint of NAME_HINTS) {
    if (hint.pattern.test(modelName)) return hint.kind;
  }
  // Anything a provider serves that is not media and not an embedding is a
  // chat model in practice. Still a guess, and still flagged as one.
  return 'text';
};

/**
 * The kind to print next to a model name, plus whether we had to guess it.
 *
 * `inferred: true` is not decoration — the caller is expected to render it
 * differently, because "we read this off the catalog" and "we pattern-matched
 * the name" are different claims and the user is the one who can settle it.
 */
export const resolveModelKindLabel = (
  provider: MediaProviderShape,
  modelName: string
): { kind?: string; inferred: boolean } => {
  const known = resolveDisplayModelKind(provider, modelName);
  if (known) return { kind: known, inferred: false };
  return { kind: inferModelKindFromName(modelName), inferred: true };
};

/** Whether the runtime can actually drive this spec end to end. */
export const isSpecExecutable = (spec: MediaModelSpec): boolean => {
  if (!EXECUTABLE_FORMS.includes(spec.form)) return false;
  if (spec.form === 'C') return IMPLEMENTED_ENDPOINT_STYLES.includes(spec.endpointStyle ?? '');
  return true;
};

/** Whether this provider+model is offered in pickers and accepted at runtime. */
export const isMediaGenSupported = (
  kind: CatalogMediaKind,
  provider: MediaProviderShape,
  modelName: string
): boolean => {
  const spec = resolveMediaModelSpec(kind, provider, modelName);
  return spec !== null && isSpecExecutable(spec);
};

export type ClippedParams = {
  params: MediaGenParams;
  /** Names of caller-supplied fields removed because the spec doesn't support them. */
  dropped: string[];
};

/**
 * Clip caller params down to what the spec supports, then merge spec defaults
 * underneath. Unsupported fields are DROPPED (and reported), never rejected —
 * a hard error would send agents into parameter-guessing loops.
 *
 * With a null spec (fallback path) all params are dropped except `n`, since
 * the legacy Form B path never consumed any of them.
 */
export const clipParamsToSpec = (params: MediaGenParams, spec: MediaModelSpec | null): ClippedParams => {
  const dropped: string[] = [];
  const out: MediaGenParams = {};
  const support = spec?.params;

  const take = <K extends keyof MediaGenParams>(key: K, supported: boolean, valid = true) => {
    const value = params[key];
    if (value === undefined) return;
    if (supported && valid) {
      out[key] = value;
    } else {
      dropped.push(key);
    }
  };

  take('size', !!support?.sizes, !params.size || !support?.sizes || support.sizes.includes(params.size));
  take(
    'aspectRatio',
    !!support?.aspectRatios,
    !params.aspectRatio || !support?.aspectRatios || support.aspectRatios.includes(params.aspectRatio)
  );
  take(
    'quality',
    !!support?.qualities,
    !params.quality || !support?.qualities || support.qualities.includes(params.quality)
  );
  take('seed', !!support?.seed);
  take('negativePrompt', !!support?.negativePrompt);
  take(
    'durationSeconds',
    !!support?.durations,
    !params.durationSeconds || !support?.durations || support.durations.includes(params.durationSeconds)
  );
  take(
    'resolution',
    !!support?.resolutions,
    !params.resolution || !support?.resolutions || support.resolutions.includes(params.resolution)
  );
  take('firstFrameImage', !!(support?.imageToVideo || support?.firstLastFrame));
  take('lastFrameImage', !!support?.firstLastFrame);
  take('generateAudio', !!support?.audio);
  take('camera', !!support?.cameras, !params.camera || !support?.cameras || support.cameras.includes(params.camera));

  // n: honored whenever >1 is supported; clamped to maxN. Legacy fallback keeps n=1.
  if (params.n !== undefined) {
    const maxN = support?.maxN ?? 1;
    if (params.n > 1 && maxN <= 1) {
      dropped.push('n');
    } else {
      out.n = Math.max(1, Math.min(Math.floor(params.n), maxN));
    }
  }

  // Merge defaults underneath (caller-provided values win).
  if (spec?.defaults) {
    if (out.size === undefined && out.aspectRatio === undefined && spec.defaults.size) out.size = spec.defaults.size;
    if (out.aspectRatio === undefined && out.size === undefined && spec.defaults.aspectRatio) {
      out.aspectRatio = spec.defaults.aspectRatio;
    }
    if (out.quality === undefined && spec.defaults.quality) out.quality = spec.defaults.quality;
    if (out.durationSeconds === undefined && spec.defaults.durationSeconds) {
      out.durationSeconds = spec.defaults.durationSeconds;
    }
    if (out.resolution === undefined && spec.defaults.resolution) out.resolution = spec.defaults.resolution;
    // Only applied when the model declares audio support and `take` above kept
    // the field eligible; an explicit caller choice already sits in `out`.
    if (out.generateAudio === undefined && support?.audio && spec.defaults.generateAudio !== undefined) {
      out.generateAudio = spec.defaults.generateAudio;
    }
  }

  return { params: out, dropped };
};

/**
 * "The catalog guessed a protocol for you, and the guess looks wrong."
 *
 * The settings modal already warns about a mismatch, but only for a style the
 * user picked by hand (`if (!mediaEndpoint) return null` — a deliberate guard,
 * since there is nothing to second-guess when the user chose nothing). That
 * leaves the default path completely unwatched, and the default path is where
 * the common failure lives: the built-in catalog matches Seedance on the model
 * name alone and resolves it to Ark's native task API, so the same model served
 * by a relay gateway is silently pointed at an API that gateway does not proxy.
 * The user sees no hint until the generation fails.
 *
 * Only `hostMismatch` is reported. The other two diagnoses answer "what is this
 * protocol" for someone who just picked it from a dropdown; surfacing them next
 * to a model the user never configured would be noise attached to a choice they
 * did not make.
 *
 * Display only — never gates. A base_url substring comparison is a heuristic,
 * and the executor now retries the sibling protocol on its own, so being wrong
 * here costs one unnecessary sentence rather than a blocked generation.
 */
export const diagnoseAutoEndpointMismatch = (
  kind: CatalogMediaKind,
  provider: MediaProviderShape,
  modelName: string
): EndpointMismatchDiagnosis => {
  if (!modelName) return null;
  // An explicit choice is the settings modal's business, not this one's.
  if (provider.model_settings?.[modelName]?.media_endpoint?.trim()) return null;

  const spec = resolveMediaModelSpec(kind, provider, modelName);

  /**
   * The seedream image entry carries no `endpointStyle` — it resolves to the
   * plain OpenAI images route — so the check below would never fire for it. But
   * it has the same failure mode as Seedance: matched on the model name alone,
   * and a relay gateway serves seedream under `/api/seedream/v1` rather than
   * `/v1/images/generations`. Flag it when the channel address is not Ark's own
   * host, the same signal the Seedance path uses; the Form A adapter retries
   * the gateway route automatically, so this is only the early hint.
   */
  if (spec?.id === ARK_SEEDREAM_CATALOG_ID) {
    const url = (provider.base_url ?? '').toLowerCase();
    if (url && !url.includes('volces.com')) {
      return { kind: 'hostMismatch', baseUrl: provider.base_url ?? '', hints: ['volces.com'] };
    }
    return null;
  }

  if (!spec?.endpointStyle) return null;

  const diagnosis = diagnoseEndpointMismatch(spec.endpointStyle, provider.base_url);
  return diagnosis?.kind === 'hostMismatch' ? diagnosis : null;
};
