/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { PROVIDERS_SWR_KEY, fetchProviders } from './useModelProviderList';

/**
 * Fixed local provider id for the one-click trial OpenRouter key.
 *
 * Using a stable id (rather than a generated one) does double duty: it lets
 * `isTrialProviderClaimed` check "do I already have one" with a plain array
 * lookup instead of tracking separate local state, and a second claim
 * attempt naturally 409s at the local create-provider call too (not just at
 * the broker), so both entry points agree on "already claimed" the same way.
 */
export const TRIAL_PROVIDER_ID = 'trial-openrouter';

export type TrialClaimOutcome =
  | 'claimed'
  | 'already_claimed'
  | 'rate_limited'
  | 'budget_exhausted'
  | 'unavailable'
  | 'error';

export interface TrialClaimResult {
  outcome: TrialClaimOutcome;
  provider?: IProvider;
}

export function isTrialProviderClaimed(providers: IProvider[] | undefined): boolean {
  return Boolean(providers?.some((p) => p.id === TRIAL_PROVIDER_ID));
}

/**
 * Claims a trial OpenRouter key and materializes it as a normal, editable
 * local provider. `displayName` is the provider's `name` field — callers
 * pass an already-translated string since this function has no i18n context
 * of its own.
 */
export async function claimTrialModel(displayName: string): Promise<TrialClaimResult> {
  let trial;
  try {
    trial = await ipcBridge.mode.requestTrialKey.invoke();
  } catch (e) {
    if (isBackendHttpError(e)) {
      if (e.status === 409) return { outcome: 'already_claimed' };
      if (e.status === 429) return { outcome: 'rate_limited' };
      if (e.status === 503) return { outcome: 'budget_exhausted' };
      if (e.status === 400) return { outcome: 'unavailable' };
    }
    return { outcome: 'error' };
  }
  if (!trial) return { outcome: 'error' };

  try {
    const provider = await ipcBridge.mode.createProvider.invoke({
      id: TRIAL_PROVIDER_ID,
      platform: 'OpenRouter',
      name: displayName,
      base_url: trial.base_url,
      api_key: trial.key,
      models: trial.models,
      enabled: true,
    });
    return { outcome: 'claimed', provider };
  } catch (e) {
    // Broker already minted and persisted the key server-side at this point
    // (dedup is keyed on this install, not on whether the local row landed),
    // so a 409 here — e.g. a duplicate click that raced past the in-flight
    // guard — reads the same as "already claimed" to the caller.
    if (isBackendHttpError(e) && e.status === 409) return { outcome: 'already_claimed' };
    return { outcome: 'error' };
  }
}

/**
 * Hook wrapper: tracks in-flight state and refreshes the shared providers
 * SWR cache (`PROVIDERS_SWR_KEY`) on success so every provider list in the
 * app picks up the new row without a manual refetch.
 */
export function useTrialModelClaim() {
  const { mutate } = useSWRConfig();
  const [claiming, setClaiming] = useState(false);

  const claim = useCallback(
    async (displayName: string): Promise<TrialClaimResult> => {
      setClaiming(true);
      try {
        const result = await claimTrialModel(displayName);
        if (result.outcome === 'claimed') {
          await mutate(PROVIDERS_SWR_KEY, fetchProviders);
        }
        return result;
      } finally {
        setClaiming(false);
      }
    },
    [mutate]
  );

  return { claim, claiming };
}
