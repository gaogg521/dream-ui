/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agnes AI image generation.
 *
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-image-21-flash (2026-09-11)
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-image-25-flash (2026-09-11)
 * (2.5 states its request parameters, sizes and pricing are identical to 2.1.)
 *
 * The route is the ordinary `POST /v1/images/generations`, so this is not a
 * different endpoint — only a different body. Sending the OpenAI-shaped one
 * fails in more than one way:
 *
 * - `n` is not a parameter. Agnes answers `400 n must be 1`.
 * - `size` is REQUIRED, and takes a tier (`1K`-`4K`), not pixels. Omitting it
 *   fails; `1024x1024` is tolerated but silently normalized to a tier.
 * - the aspect ratio is a separate `ratio` field, not encoded into `size`.
 * - a reference image is `image: string[]` in the JSON body. The standard path
 *   sends multipart to an edits route Agnes does not serve.
 * - `seed`, `negative_prompt` and `quality` are not parameters at all.
 *
 * `toGatewayImageRef` is borrowed from the seedream gateway rather than
 * duplicated: "HTTP URL through, local file to a data URI" is exactly what
 * Agnes documents for `image` too, and one copy cannot drift from the other.
 */

import { AGNES_IMAGE_SIZES } from '../catalog/imageModels';
import type { MediaGenParams } from '../types';
import { toGatewayImageRef } from './seedreamGateway';

/**
 * `size` is required by the API, so a request that reaches here without one
 * still has to carry a tier. 2K is the vendor's own worked example and the tier
 * it recommends for 16:9 display material.
 */
const DEFAULT_SIZE = '2K';

/** Pixel spellings are accepted but normalized; a tier is what we send. */
const asTier = (size: string | undefined): string => {
  if (!size) return DEFAULT_SIZE;
  const tier = size.trim().toUpperCase();
  return AGNES_IMAGE_SIZES.includes(tier) ? tier : DEFAULT_SIZE;
};

export const buildAgnesImageBody = (
  model: string,
  prompt: string,
  params: MediaGenParams,
  imageRefs: string[] = []
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model,
    prompt,
    size: asTier(params.size),
  };
  if (params.aspectRatio) body.ratio = params.aspectRatio;
  // Multi-image composition is the same field with more entries.
  if (imageRefs.length > 0) body.image = imageRefs;
  return body;
};

export { toGatewayImageRef as toAgnesImageRef };
