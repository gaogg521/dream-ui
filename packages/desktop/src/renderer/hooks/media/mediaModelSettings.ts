/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persisting the media model the user picked in a conversation.
 *
 * The pick is written back to the same `tools.imageGenerationModel` /
 * `tools.videoGenerationModel` keys the Settings page has always used, so it is
 * remembered as the default for the next conversation and the execution path
 * (`process/services/mediaJob`) reads it with no extra wiring. Secrets are never
 * stored here — the reference carries `id`/`platform` and the job engine
 * re-resolves the provider (and its api_key) from `/api/providers` at run time.
 */

import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import type { MediaKind } from '@/common/media/types';
import { getClientBusinessSetting, setClientBusinessSetting } from '@renderer/services/clientBusinessSettings';

const SETTING_KEY = {
  image: 'tools.imageGenerationModel',
  video: 'tools.videoGenerationModel',
} as const;

export type MediaModelRef = { id: string; name: string; platform: string; use_model: string };

/**
 * Write the chosen provider+model as the default for `kind`.
 *
 * Reads the existing value first so a legacy `switch` flag (deprecated, but
 * still consulted by the first-install migration) is carried through rather
 * than dropped.
 */
export const persistMediaModelSelection = async (kind: MediaKind, ref: MediaModelRef): Promise<void> => {
  const key = SETTING_KEY[kind];
  const prev = await getClientBusinessSetting(key);
  const next = {
    ...prev,
    id: ref.id,
    name: ref.name,
    platform: ref.platform,
    use_model: ref.use_model,
    base_url: '',
    api_key: '',
  } as ImageGenerationModelSetting;
  await setClientBusinessSetting(key, next);
};
