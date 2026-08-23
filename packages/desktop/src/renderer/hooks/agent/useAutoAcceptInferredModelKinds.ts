/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Promotes every inferred model kind into a real declaration automatically,
 * so a well-named custom model (e.g. `agnes-image-2.0-flash`) becomes usable
 * in the image/video generation pickers without the user having to open the
 * model list and click the accept button first.
 *
 * This does NOT change what "declared" means anywhere else in the app — it
 * only automates the same write `acceptInferredKinds` (ModelModalContent)
 * already performs on a manual click. The guess is still just a guess until
 * this runs; a wrong guess is still one click away from being corrected in
 * the model list, same as before.
 *
 * Mounted once (see `main.tsx`) rather than folded into `useProvidersQuery`
 * itself: `useSWR`'s `onSuccess` fires per subscribing hook instance, and
 * that hook is called from many places (send box selectors, settings pages,
 * the tools tab). A single dedicated subscriber avoids firing this write once
 * per mounted consumer.
 */

import { useCallback, useRef } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { ipcBridge } from '@/common';
import type { IProvider } from '@/common/config/storage';
import { inferredModelKinds } from '@/common/utils/modelCapabilities';
import { fetchProviders, PROVIDERS_SWR_KEY, PROVIDERS_SWR_OPTIONS } from './useModelProviderList';

/** Same write `acceptInferredKinds` performs, extracted so both call sites agree. */
const declareInferredKinds = (platform: IProvider): IProvider => {
  const entries = inferredModelKinds(platform);
  if (!entries.length) return platform;
  const model_settings = { ...platform.model_settings };
  for (const { model, kind } of entries) {
    model_settings[model] = { ...model_settings[model], model_kind: kind };
  }
  return { ...platform, model_settings };
};

export const useAutoAcceptInferredModelKinds = (ready: boolean): void => {
  // Prevents overlapping runs: onSuccess fires again once our own mutate()
  // resolves, and by then every entry is declared so the next pass is a
  // no-op — but without this guard two rapid data updates could both see the
  // same still-inferred entries and race to write them.
  const runningRef = useRef(false);

  const handleData = useCallback(async (providers: IProvider[] | undefined) => {
    if (runningRef.current || !providers?.length) return;

    // A company-provisioned channel is not this member's to edit — the sync
    // would restore whatever this wrote, same exclusion the manual "accept"
    // button in the model list uses.
    const withGuesses = providers.filter(
      (platform) => platform.managed_by !== 'enterprise' && inferredModelKinds(platform).length > 0
    );
    if (!withGuesses.length) return;

    runningRef.current = true;
    try {
      // One provider's write failing must not block another's — each is
      // independent, so run them concurrently rather than one at a time.
      const results = await Promise.all(
        withGuesses.map(async (platform) => {
          const { id, ...body } = declareInferredKinds(platform);
          try {
            await ipcBridge.mode.updateProvider.invoke({ id, ...body });
            return true;
          } catch (error) {
            console.error('Failed to auto-declare inferred model kinds for provider', id, error);
            return false;
          }
        })
      );
      // Every other subscriber of this key (settings pages, generation model
      // pickers) is still holding the pre-write data until this fires.
      if (results.some(Boolean)) void globalMutate(PROVIDERS_SWR_KEY);
    } finally {
      runningRef.current = false;
    }
  }, []);

  useSWR<IProvider[]>(ready ? PROVIDERS_SWR_KEY : null, fetchProviders, {
    ...PROVIDERS_SWR_OPTIONS,
    onSuccess: (data) => {
      void handleData(data);
    },
  });
};
