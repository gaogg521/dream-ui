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
 * - a reference image goes in `extra_body.image` — NOT at the top level, and
 *   not as multipart to an edits route Agnes does not serve. See below.
 * - `seed`, `negative_prompt` and `quality` are not parameters at all.
 *
 * # `image` belongs under `extra_body`
 *
 * The docs' parameter table lists `image` in the same column as `model` and
 * `prompt`, which reads as a top-level field. It is not one. The table also
 * lists `extra_body.response_format` with its prefix spelled out, and the
 * worked `curl` on the same page puts `image` inside `extra_body` — the sample
 * is what the service actually implements.
 *
 * Sent at the top level it fails with `400 LLM Provider NOT provided ...
 * You passed model=agnes-image-2.5-flash`, which names the model and says
 * nothing about `image`. That message cost a full debugging session: it reads
 * as a routing or credentials problem, and text-to-image on the same model,
 * key and route keeps working, so nothing points at the reference image.
 *
 * Measured 2026-09-15 against `apihub.agnes-ai.com/v1/images/generations`,
 * same prompt and key, only the placement differing:
 *
 *   image at top level      -> 400 "LLM Provider NOT provided"
 *   image under extra_body  -> 200, image returned
 *
 * A malformed value under `extra_body` answers
 * `image must be a public http(s) URL or valid image base64` instead — proof
 * the field is being read there rather than ignored.
 *
 * `response_format` is deliberately not sent: the caller handles both `url`
 * and `b64_json` responses, so there is nothing to gain from pinning one and
 * the service's own default stays in play.
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
  // Multi-image composition is the same field with more entries. Nested under
  // `extra_body` — see the module docs for what the top level does instead.
  if (imageRefs.length > 0) body.extra_body = { image: imageRefs };
  return body;
};

export { toGatewayImageRef as toAgnesImageRef };
