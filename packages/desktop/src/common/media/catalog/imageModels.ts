/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in image model catalog.
 *
 * Ordering matters: entries are evaluated top-down and the first match wins.
 * Put provider-pinned entries (platform / base_url / provider-name matches)
 * before generic model-name-only entries.
 *
 * Form C entries are listed with their real protocol data but only become
 * selectable/executable once the async job engine lands (phase 2) — the
 * resolver gates on EXECUTABLE_FORMS.
 */

import type { MediaModelSpec } from './types';

/**
 * Catalog id for the direct-Ark Seedream entry below.
 *
 * Lives here (renderer-safe `catalog/`) rather than next to the gateway adapter,
 * which imports `fs`/`path`: both the adapter and the resolver need to recognise
 * this vendor family, and the resolver cannot pull in a Node-only module.
 */
export const ARK_SEEDREAM_CATALOG_ID = 'ark-seedream';

/**
 * Catalog id for the Seedream 5 entry below.
 *
 * Seedream 5 gets its own entry because its API floors `size` at 3,686,400
 * total pixels — measured: `size: "1024x1024"` answers 400 "image size must be
 * at least 3686400 pixels" — so every pixel size the 4.x-era entry offers,
 * including its default, is a value this generation rejects outright. Tier
 * strings (`"size": "2K"`) are the vocabulary its documentation uses.
 */
export const ARK_SEEDREAM_5_CATALOG_ID = 'ark-seedream-5';

/**
 * Whether a catalog id belongs to the seedream family, any generation.
 *
 * Behaviors that hold across the family — watermark suppression and the
 * gateway-route auto-fallback in `openaiImagesAdapter.ts`, the non-Ark host
 * hint in `resolve.ts` — key on this rather than on one entry's id, so a new
 * generation's entry cannot silently lose them.
 */
export const isArkSeedreamFamilyId = (id: string | undefined): boolean =>
  id === ARK_SEEDREAM_CATALOG_ID || id === ARK_SEEDREAM_5_CATALOG_ID;

export const BUILTIN_IMAGE_MODELS: MediaModelSpec[] = [
  // ===== Provider-pinned Form B entries (preserve the legacy allowlist rules) =====
  {
    id: 'gemini-image-preview',
    kind: 'image',
    form: 'B',
    match: {
      platform: ['gemini', 'gemini-vertex-ai'],
      model: /(image|banana|imagine)/i,
    },
    params: { imageInput: true },
  },
  {
    id: 'openrouter-image',
    kind: 'image',
    form: 'B',
    match: {
      baseUrlIncludes: ['openrouter.ai'],
      model: /(image|banana|imagine)/i,
    },
    params: { imageInput: true },
  },
  {
    id: 'antigravity-image',
    kind: 'image',
    form: 'B',
    match: {
      providerNameIncludes: ['antigravity'],
      model: /(image|banana|imagine)/i,
    },
    params: { imageInput: true },
  },

  // ===== Form A — OpenAI images API and compatible gateways =====
  {
    // Whole gpt-image family, not just -1: gateways ship -2 and vendor-suffixed
    // variants (`gpt-image-2-joymaker`), and pinning the generation number left
    // working models unselectable.
    id: 'openai-gpt-image',
    kind: 'image',
    form: 'A',
    match: { model: /^gpt-image/i },
    params: {
      sizes: ['1024x1024', '1536x1024', '1024x1536', 'auto'],
      qualities: ['low', 'medium', 'high', 'auto'],
      maxN: 4,
      imageInput: true,
    },
    // No size/quality defaults: gateway-hosted variants reject values the
    // official model accepts, and omitting them lets the server choose.
  },
  {
    id: 'openai-dall-e-3',
    kind: 'image',
    form: 'A',
    match: { model: /^dall-e-3/i },
    params: {
      sizes: ['1024x1024', '1792x1024', '1024x1792'],
      qualities: ['standard', 'hd'],
      maxN: 1,
    },
    defaults: { size: '1024x1024', quality: 'standard' },
  },
  {
    id: 'openai-dall-e-2',
    kind: 'image',
    form: 'A',
    match: { model: /^dall-e-2/i },
    params: {
      sizes: ['256x256', '512x512', '1024x1024'],
      maxN: 10,
      imageInput: true,
    },
    defaults: { size: '1024x1024' },
  },
  {
    // Seedream 5 must sit ABOVE the generic seedream entry below: first match
    // wins, and the family-wide /seedream/ regex would otherwise swallow it.
    //
    // The 5.x API floors `size` at 3,686,400 total pixels (measured against a
    // relay of Ark's native images API: `1024x1024` answers 400 "image size
    // must be at least 3686400 pixels"), so the 1K-class pixel sizes the 4.x
    // entry offers are values this generation rejects, and its `1024x1024`
    // default would be a guaranteed failure on every request. Tier strings are
    // the documented vocabulary — `"size": "2K"` — so 2K is both the floor and
    // the default.
    id: ARK_SEEDREAM_5_CATALOG_ID,
    kind: 'image',
    form: 'A',
    match: { model: /seedream-?5/i },
    params: {
      sizes: ['2K', '4K'],
      seed: true,
      // Same measured endpoint behavior as the rest of the family: `n` is
      // ignored (one image per request), several images come from the
      // fan-out in executeMediaGeneration.
      maxN: 1,
    },
    defaults: { size: '2K' },
  },
  {
    // Seedream on Volcano Ark exposes a synchronous OpenAI-style images API.
    // `openaiImagesAdapter.ts` keys the watermark-suppression field and the
    // gateway auto-fallback on this family (`isArkSeedreamFamilyId`).
    id: ARK_SEEDREAM_CATALOG_ID,
    kind: 'image',
    form: 'A',
    match: { model: /seedream/i },
    params: {
      // Pixel sizes are what was measured against Ark's direct endpoint. The
      // tier strings ("2K", "4K") are the same family's vocabulary on the
      // native v3 API and gateway frontings of it, so a caller can ask for a
      // tier here too — a host that wants pixels answers with a plain 400
      // naming the value, not a silent failure.
      sizes: [
        '1024x1024',
        '1152x864',
        '864x1152',
        '1280x720',
        '720x1280',
        '832x1248',
        '1248x832',
        '1512x648',
        '2K',
        '4K',
      ],
      seed: true,
      /**
       * One image per request, measured against the real endpoint.
       *
       * The vendor console offers a 1–9 count, so this looked like an
       * under-report. It is not: Ark's OpenAI-compatible images endpoint
       * **silently ignores `n`** for this model — `n: 99` returns HTTP 200 with
       * a single image — and its group-image parameter is rejected outright
       * (`sequential_image_generation is not supported by the current model`).
       * The console's count must be reaching the model some other way.
       *
       * So `maxN` stays 1, because it describes what one request returns.
       * Asking for several images is handled above this layer, by issuing
       * several requests (see `fanOutCount` in executeMediaGeneration) — that
       * is what makes them independent takes rather than one batch.
       */
      maxN: 1,
    },
    defaults: { size: '1024x1024' },
  },
  {
    // FLUX family — SiliconFlow, Together, fal, and OpenAI-compatible gateways.
    id: 'flux',
    kind: 'image',
    form: 'A',
    match: { model: /flux/i },
    params: {
      sizes: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280', '1280x720', '1440x720'],
      seed: true,
      maxN: 4,
    },
    defaults: { size: '1024x1024' },
  },
  {
    // Stable Diffusion family on OpenAI-compatible gateways.
    id: 'stable-diffusion',
    kind: 'image',
    form: 'A',
    match: { model: /(stable-diffusion|sd-?3|sd-?3\.5|sdxl)/i },
    params: {
      sizes: ['1024x1024', '512x1024', '768x512', '768x1024', '1024x576', '576x1024'],
      seed: true,
      negativePrompt: true,
      maxN: 4,
    },
    defaults: { size: '1024x1024' },
  },
  {
    // Zhipu CogView (bigmodel.cn, OpenAI-compatible images endpoint).
    id: 'cogview',
    kind: 'image',
    form: 'A',
    match: { model: /cogview/i },
    params: {
      sizes: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
      maxN: 1,
    },
    defaults: { size: '1024x1024' },
  },

  // ===== Form C — async task APIs (data ready; executable from phase 2) =====
  {
    // Tongyi WanX text-to-image on DashScope's native async task API.
    id: 'dashscope-wanx-image',
    kind: 'image',
    form: 'C',
    endpointStyle: 'dashscope-task',
    // Matches wanx-v1 / wanx2.1-t2i-turbo / wan2.2-t2i-flash naming generations.
    match: { model: /^wan(x|2)/i },
    params: {
      sizes: ['1024x1024', '720x1280', '1280x720', '768x1152'],
      seed: true,
      negativePrompt: true,
      maxN: 4,
    },
    defaults: { size: '1024x1024' },
    polling: { intervalMs: 3000, timeoutMs: 300_000 },
  },
  {
    // Jimeng (即梦) image generation on Volcano Ark's async task API.
    id: 'ark-jimeng-image',
    kind: 'image',
    form: 'C',
    endpointStyle: 'ark-task',
    match: { model: /jimeng/i },
    params: {
      sizes: ['1024x1024', '1280x720', '720x1280'],
      seed: true,
      maxN: 4,
    },
    defaults: { size: '1024x1024' },
    polling: { intervalMs: 3000, timeoutMs: 300_000 },
  },
];
