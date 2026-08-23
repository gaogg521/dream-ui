/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finding the media model a user has declared, without them picking one in
 * Settings > Tools.
 *
 * Those two settings keys (`tools.imageGenerationModel` /
 * `tools.videoGenerationModel`) predate `model_kind`: back then choosing one
 * there was the only way to have a media model, so everything downstream read
 * that key and nothing else. Declaring a model as image/video in the provider
 * list — the way the product asks for it now — leaves those keys empty, which
 * left two things broken:
 *
 * - an agent calling the media MCP tool was told "no model is configured" even
 *   though one plainly was (the send box never hit this: it passes its model
 *   explicitly);
 * - the built-in media MCP stayed disabled, so the tools were not offered at
 *   all.
 *
 * Both now fall back to this. Kept as one shared predicate rather than a copy
 * on each side, for the same reason `isMediaGenSupported` is shared: the answer
 * to "does this user have a video model" must not be able to differ between the
 * place that decides to offer the tool and the place that runs it.
 */

import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import type { IProvider } from '@/common/config/storage';
import { isMediaGenSupported } from '@/common/media/catalog';
import type { MediaKind } from '@/common/media/types';

/**
 * The first model any provider offers for this kind, shaped as the selection
 * the resolver expects.
 *
 * First match wins: when several models are declared, any of them can serve the
 * request, and asking the user to rank them would be a setting answering a
 * question they have not asked. An explicit choice in Settings still wins — this
 * is only consulted when there is none.
 */
export const findDeclaredMediaModel = (
  kind: MediaKind,
  providers: IProvider[] | undefined
): ImageGenerationModelSetting | undefined => {
  for (const provider of providers || []) {
    for (const model of provider.models || []) {
      if (!isMediaGenSupported(kind, provider, model)) continue;
      return {
        id: provider.id,
        name: provider.name,
        platform: provider.platform,
        base_url: '',
        api_key: '',
        use_model: model,
      };
    }
  }
  return undefined;
};

/**
 * Whether any provider offers a model declared as image *or* video.
 *
 * This is what decides the media tools are worth giving to an agent: declaring
 * a media model is the user saying they want media generation, and requiring a
 * second, older switch on top of it only hides the capability they configured.
 */
export const hasDeclaredMediaModel = (providers: IProvider[] | undefined): boolean =>
  Boolean(findDeclaredMediaModel('image', providers) || findDeclaredMediaModel('video', providers));
