/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seedream behind a gateway that fronts it under its own path.
 *
 * Synchronous, so this is not a task driver — it is Form A with two differences
 * that the plain OpenAI images path cannot express:
 *
 * 1. **The routes live under `/api/seedream/v1/`, not `/v1/`.** Asking the
 *    gateway for `/v1/images/generations` with a seedream model answers
 *    `404 model "…" not found` — the model is genuinely not mounted there. This
 *    is the same shape as the seedance video routes (`/api/seedance/*`), which
 *    is presumably how the gateway namespaces vendor-native APIs.
 * 2. **A reference image is a data URI in the JSON body**, under `image`, on
 *    the same generations route. The OpenAI protocol would send multipart to a
 *    separate `/images/edits`; doing that here is answered by a Go JSON
 *    decoding error, because there is no such route to receive it.
 *
 * Both shapes come from a request captured against the running deployment, not
 * from documentation, and were re-verified with this application's own key.
 *
 * The host is deliberately not written down anywhere: this style is selected by
 * the user on the model ("declare which endpoint this model speaks"), so the
 * same code serves any deployment that fronts seedream this way.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isHttpUrl, resolveLocalInputPath } from '../mediaAssets';
import type { MediaGenParams } from '../types';

/** The id a user selects on the model to route it here. */
export const SEEDREAM_GATEWAY_STYLE = 'seedream-gateway';

/**
 * Catalog id for the "direct Ark" seedream entry (imageModels.ts).
 *
 * Kept as a shared constant so the plain Form A path can recognize this
 * vendor family without duplicating the id string.
 */
export const ARK_SEEDREAM_CATALOG_ID = 'ark-seedream';

/**
 * The generations root for this style.
 *
 * Built from the provider's chat `base_url` by dropping any version suffix and
 * appending the namespace, so one set of credentials serves chat and media.
 */
export const seedreamGatewayBaseUrl = (baseUrl: string): string => {
  const host = (baseUrl || '').replace(/\/+$/, '').replace(/\/v\d+(beta)?$/i, '');
  return `${host}/api/seedream/v1`;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/**
 * Turn a reference image into what the body expects.
 *
 * An HTTP URL is passed through — the gateway fetches it itself, and inlining
 * it would mean downloading bytes only to re-upload them. A local file becomes
 * a data URI, which is the only way this route accepts one.
 */
export const toGatewayImageRef = async (uri: string, workspaceDir: string): Promise<string> => {
  if (isHttpUrl(uri)) return uri;
  const fullPath = await resolveLocalInputPath(uri, workspaceDir);
  const bytes = await fs.promises.readFile(fullPath);
  const mime = MIME_BY_EXTENSION[path.extname(fullPath).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${bytes.toString('base64')}`;
};

/**
 * The request body.
 *
 * `watermark: false` and `stream: false` are sent explicitly rather than left to
 * the gateway: the captured request carries both, and a watermarked image is
 * not something to discover after paying for it.
 */
export const buildSeedreamGatewayBody = (
  model: string,
  prompt: string,
  params: MediaGenParams,
  imageRef?: string
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model,
    prompt,
    output_format: 'png',
    watermark: false,
    stream: false,
  };
  if (params.size) body.size = params.size;
  if (params.seed !== undefined) body.seed = params.seed;
  if (imageRef) body.image = imageRef;
  return body;
};
