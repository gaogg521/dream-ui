/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form A adapter — synchronous OpenAI-style images API.
 *
 * Covers `POST {base}/images/generations` (text-to-image) and
 * `POST {base}/images/edits` (image-to-image, when the spec declares
 * imageInput). Works for OpenAI (DALL·E, gpt-image-1) and the wide field of
 * OpenAI-compatible gateways (SiliconFlow, new-api/one-api, Azure OpenAI,
 * Ark Seedream, Zhipu CogView...).
 *
 * Response handling accepts both canonical `data[]` items (`b64_json` | `url`)
 * and the `images[]` variant some gateways use.
 */

import type OpenAI from 'openai';
import { toFile } from 'openai';
import { ClientFactory } from '@/common/api/ClientFactory';
import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import { ARK_SEEDREAM_CATALOG_ID } from '../catalog/imageModels';
import { classifyMediaFailure } from '../failureClass';
import { downloadUrlMediaAsset, isHttpUrl, resolveLocalInputPath, saveBase64MediaAsset } from '../mediaAssets';
import type { MediaAsset, MediaGenOutcome, MediaGenRequest, MediaProviderAdapter } from '../types';
import { ensureVersionedBaseUrl } from './baseUrl';
import {
  buildSeedreamGatewayBody,
  SEEDREAM_GATEWAY_STYLE,
  seedreamGatewayBaseUrl,
  toGatewayImageRef,
} from './seedreamGateway';
import * as fs from 'fs';
import * as path from 'path';

const API_TIMEOUT_MS = 180000; // 3 minutes — high-quality gpt-image renders can be slow

type ImageResultItem = { b64_json?: string; url?: string };

export class OpenAiImagesAdapter implements MediaProviderAdapter {
  readonly form = 'A' as const;

  async generate(req: MediaGenRequest): Promise<MediaGenOutcome> {
    const { prompt, params, inputUris, provider, workspaceDir, proxy, signal, spec } = req;

    if (signal?.aborted) {
      return { success: false, assets: [], text: 'Image generation was cancelled.', error: 'cancelled' };
    }

    /**
     * Seedream behind a gateway speaks the images protocol, but under its own
     * path (`/api/seedream/v1/...`) and with the reference image inline, so the
     * route and the way an input is attached both change while everything after
     * the response is identical. Which shape the model wants is decided by the
     * endpoint style the user pinned, if any.
     */
    const isSeedreamFamily = spec?.id === ARK_SEEDREAM_CATALOG_ID;
    const pinnedGateway = spec?.endpointStyle === SEEDREAM_GATEWAY_STYLE;

    /**
     * One synchronous call against either the plain images route or the seedream
     * gateway route. Isolated so the dispatcher below can retry it under the
     * other shape when the first proves this host does not serve it.
     */
    const callOnce = async (viaGateway: boolean): Promise<OpenAI.Images.ImagesResponse> => {
      const client = await ClientFactory.createRotatingClient(provider, {
        proxy,
        rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
        baseConfig: {
          baseURL: viaGateway ? seedreamGatewayBaseUrl(provider.base_url) : ensureVersionedBaseUrl(provider.base_url),
        },
      });

      if (!(client instanceof OpenAIRotatingClient)) {
        throw new Error(
          `model "${provider.use_model}" resolved to the images API, but provider platform "${provider.platform}" does not speak the OpenAI protocol.`
        );
      }

      if (viaGateway) {
        /**
         * One route for both directions: a reference image rides in the body,
         * so text-to-image and image-to-image differ only by whether `image` is
         * present. There is no edits route here to send multipart to — trying
         * that is what produced the JSON-decoding error this replaces.
         */
        const imageRef = inputUris[0] ? await toGatewayImageRef(inputUris[0], workspaceDir) : undefined;
        return (await client.createImage(
          buildSeedreamGatewayBody(
            provider.use_model,
            prompt,
            params,
            imageRef
          ) as unknown as OpenAI.Images.ImageGenerateParams,
          { signal, timeout: API_TIMEOUT_MS }
        )) as OpenAI.Images.ImagesResponse;
      }

      const requestParams: Record<string, unknown> = {
        model: provider.use_model,
        prompt,
        n: params.n ?? 1,
      };
      if (params.size) requestParams.size = params.size;
      if (params.quality) requestParams.quality = params.quality;
      // Gateway extensions beyond the OpenAI schema — harmless for providers
      // that ignore unknown fields, essential for SD/Flux-style gateways.
      if (params.seed !== undefined) requestParams.seed = params.seed;
      if (params.negativePrompt) requestParams.negative_prompt = params.negativePrompt;
      /**
       * Ark's direct images endpoint defaults to stamping a vendor watermark
       * (confirmed 2026-08-10 via a real generation). Scoped to this catalog
       * entry only, so it never touches Flux/SD/DALL-E/etc.
       */
      if (isSeedreamFamily) requestParams.watermark = false;

      if (inputUris.length > 0 && spec?.params.imageInput) {
        const imageFiles = await Promise.all(
          inputUris
            .filter((uri) => !isHttpUrl(uri))
            .map(async (uri) => {
              const fullPath = await resolveLocalInputPath(uri, workspaceDir);
              await fs.promises.access(fullPath, fs.constants.F_OK);
              return toFile(fs.createReadStream(fullPath), path.basename(fullPath));
            })
        );
        if (imageFiles.length === 0) {
          throw new Error(
            'image editing via the images API requires local image files (HTTP URLs are not supported by this endpoint). Download the image to the workspace first.'
          );
        }
        return client.createImageEdit(
          {
            ...requestParams,
            image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
          } as unknown as OpenAI.Images.ImageEditParams,
          { signal, timeout: API_TIMEOUT_MS }
        );
      }

      return client.createImage(requestParams as unknown as OpenAI.Images.ImageGenerateParams, {
        signal,
        timeout: API_TIMEOUT_MS,
      });
    };

    /**
     * Submit, and when the plain route proves seedream is not served there, try
     * the gateway route (or the reverse) before giving up.
     *
     * Same shape as the video side's `submitWithFallback`, with one difference:
     * `modelNotFound` also triggers it, not only `notRouted`. A relay gateway
     * that mounts seedream under `/api/seedream/v1` answers the *plain*
     * `/v1/images/generations` with `404 model "..." not found` — a genuine
     * "no such model", by the letter of the classifier, but here it is the
     * exact signature of "wrong route for this vendor". The cost of being wrong
     * (a truly missing model) is one extra millisecond-scale 404, and it is
     * gated to the one `ark-seedream` catalog entry, so the blast radius is
     * tiny — the same "guessing is fine when it is cheap" trade the classifier
     * itself is built on.
     */
    let response: OpenAI.Images.ImagesResponse;
    try {
      req.onProgress?.({ stage: 'running' });
      response = await callOnce(pinnedGateway);
    } catch (error) {
      if (signal?.aborted) {
        return { success: false, assets: [], text: 'Image generation was cancelled.', error: 'cancelled' };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failureClass = classifyMediaFailure(errorMessage);
      const routingMiss = failureClass === 'notRouted' || failureClass === 'modelNotFound';

      if (!isSeedreamFamily || !routingMiss) {
        console.error('[MediaGen][FormA] API call failed:', error);
        return { success: false, assets: [], text: `Error generating image: ${errorMessage}`, error: errorMessage };
      }

      try {
        response = await callOnce(!pinnedGateway);
      } catch (fallbackError) {
        if (signal?.aborted) {
          return { success: false, assets: [], text: 'Image generation was cancelled.', error: 'cancelled' };
        }
        // The gateway sibling did not answer either. Report the original error —
        // it names the route the model was configured for — with the attempt
        // appended so the advice that follows is not read as untried.
        const triedStyle = pinnedGateway ? 'the plain images API' : SEEDREAM_GATEWAY_STYLE;
        console.error('[MediaGen][FormA] API call failed (sibling route too):', fallbackError);
        return {
          success: false,
          assets: [],
          text: `Error generating image: ${errorMessage} Automatically retried under ${triedStyle}, with the same result.`,
          error: errorMessage,
        };
      }

      // The sibling route worked. Persist the discovery so every later
      // generation does not pay for this same probe. Pinned-gateway → plain
      // means the pin was wrong; clear it back to auto ('').
      req.onEndpointStyleSwitched?.(pinnedGateway ? '' : SEEDREAM_GATEWAY_STYLE);
    }

    try {
      const items = extractResultItems(response);
      if (items.length === 0) {
        return {
          success: false,
          assets: [],
          text: `Image generation returned no images. Raw response keys: ${Object.keys(response || {}).join(', ')}`,
          error: 'empty-response',
        };
      }

      req.onProgress?.({ stage: 'saving' });

      const assets: MediaAsset[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.b64_json) {
          assets.push(await saveBase64MediaAsset('image', item.b64_json, workspaceDir, i));
        } else if (item.url) {
          assets.push(await downloadUrlMediaAsset('image', item.url, workspaceDir, i));
        }
      }

      if (assets.length === 0) {
        return {
          success: false,
          assets: [],
          text: 'Image generation response contained neither base64 data nor URLs.',
          error: 'empty-items',
        };
      }

      const revisedPrompt = (response.data?.[0] as { revised_prompt?: string } | undefined)?.revised_prompt;
      const text = revisedPrompt ? `Revised prompt: ${revisedPrompt}` : 'Image generated successfully.';
      return { success: true, assets, text };
    } catch (error) {
      if (signal?.aborted) {
        return { success: false, assets: [], text: 'Image generation was cancelled.', error: 'cancelled' };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[MediaGen][FormA] saving result failed:', error);
      return { success: false, assets: [], text: `Error generating image: ${errorMessage}`, error: errorMessage };
    }
  }
}

function extractResultItems(response: OpenAI.Images.ImagesResponse): ImageResultItem[] {
  if (Array.isArray(response?.data) && response.data.length > 0) {
    return response.data as ImageResultItem[];
  }
  // Some gateways (e.g. SiliconFlow) answer with `images: [{url}]` instead.
  const alt = (response as unknown as { images?: ImageResultItem[] })?.images;
  if (Array.isArray(alt) && alt.length > 0) {
    return alt;
  }
  return [];
}
