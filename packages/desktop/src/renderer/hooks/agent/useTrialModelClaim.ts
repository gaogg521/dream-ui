/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { IProvider } from '@/common/config/storage';
import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { PROVIDERS_SWR_KEY, fetchProviders } from './useModelProviderList';

/**
 * A trial vendor the one-click offer can claim from.
 *
 *  - `openrouter` — mode A: the broker mints a capped upstream key, the
 *    client talks to OpenRouter directly.
 *  - `baoyun` — mode B: the broker proxies inference under its own key and
 *    meters spend against a local CNY ledger; when it runs out the user tops
 *    up (see `MeteredTopUpModal`).
 */
export type TrialVendor = 'openrouter' | 'baoyun';

/** All vendors, in the order the picker offers them. */
export const TRIAL_VENDORS: readonly TrialVendor[] = ['baoyun', 'openrouter'];

/** The subset that is metered (mode B) — the ones a top-up applies to. */
export const METERED_TRIAL_VENDORS: readonly TrialVendor[] = ['baoyun'];

export function isMeteredTrialVendor(vendor: TrialVendor): boolean {
  return METERED_TRIAL_VENDORS.includes(vendor);
}

/**
 * Fixed local provider id per vendor.
 *
 * A stable id does double duty: `isTrialProviderClaimed` becomes a plain
 * array lookup, and a second claim naturally collides at the local
 * create-provider call too (not just at the broker), so both entry points
 * agree on "already claimed".
 */
export const TRIAL_PROVIDER_ID_BY_VENDOR: Record<TrialVendor, string> = {
  openrouter: 'trial-openrouter',
  baoyun: 'trial-baoyun',
};

/** Back-compat: the original single-vendor constant. */
export const TRIAL_PROVIDER_ID = TRIAL_PROVIDER_ID_BY_VENDOR.openrouter;

const TRIAL_PROVIDER_IDS = new Set(Object.values(TRIAL_PROVIDER_ID_BY_VENDOR));

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

/** Whether this vendor's trial provider is present (any vendor when omitted). */
export function isTrialProviderClaimed(providers: IProvider[] | undefined, vendor?: TrialVendor): boolean {
  const wanted = vendor ? TRIAL_PROVIDER_ID_BY_VENDOR[vendor] : undefined;
  return Boolean(providers?.some((p) => (wanted ? p.id === wanted : TRIAL_PROVIDER_IDS.has(p.id))));
}

/** The trial provider this install holds for `vendor`, if any. */
export function findTrialProvider(providers: IProvider[] | undefined, vendor: TrialVendor): IProvider | undefined {
  return providers?.find((p) => p.id === TRIAL_PROVIDER_ID_BY_VENDOR[vendor]);
}

/** Which trial vendor a provider id belongs to, if it is one of ours. */
export function trialVendorOfProviderId(providerId: string): TrialVendor | undefined {
  return (Object.keys(TRIAL_PROVIDER_ID_BY_VENDOR) as TrialVendor[]).find(
    (vendor) => TRIAL_PROVIDER_ID_BY_VENDOR[vendor] === providerId
  );
}

async function claimIssuedKey(displayName: string): Promise<TrialClaimResult> {
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
      id: TRIAL_PROVIDER_ID_BY_VENDOR.openrouter,
      // The broker names the platform — it can be repointed at a different
      // token platform without a client release. The fallback is only for a
      // broker deployed before the field existed.
      platform: trial.platform || 'OpenRouter',
      name: displayName,
      base_url: trial.base_url,
      api_key: trial.key,
      models: trial.models,
      enabled: true,
    });
    return { outcome: 'claimed', provider };
  } catch (e) {
    // The broker already minted and recorded the key server-side (dedup is
    // keyed on the install, not on whether the local row landed), so a 409
    // here reads the same as "already claimed".
    if (isBackendHttpError(e) && e.status === 409) return { outcome: 'already_claimed' };
    return { outcome: 'error' };
  }
}

async function claimMeteredAccount(vendor: TrialVendor, displayName: string): Promise<TrialClaimResult> {
  let access;
  try {
    access = await ipcBridge.mode.meteredClaim.invoke({ vendor });
  } catch (e) {
    // Mode B claim is idempotent (the broker rotates the token), so it never
    // 409s. A 404 means the broker has no such metered vendor configured; a
    // 400 means it is not wired up at all — both are "unavailable".
    if (isBackendHttpError(e) && (e.status === 404 || e.status === 400)) {
      return { outcome: 'unavailable' };
    }
    if (isBackendHttpError(e) && e.status === 429) return { outcome: 'rate_limited' };
    return { outcome: 'error' };
  }
  if (!access) return { outcome: 'error' };

  try {
    const provider = await ipcBridge.mode.createProvider.invoke({
      id: TRIAL_PROVIDER_ID_BY_VENDOR[vendor],
      // A metered account is a plain custom provider pointed at the broker's
      // proxy — there is no dedicated platform for it.
      platform: 'custom',
      name: displayName,
      base_url: access.base_url,
      api_key: access.device_token,
      models: access.models,
      enabled: true,
    });
    return { outcome: 'claimed', provider };
  } catch (e) {
    // A re-claim rotated the device token; the stale local provider still
    // points at the broker with an old bearer. Overwrite it.
    if (isBackendHttpError(e) && e.status === 409) {
      try {
        const provider = await ipcBridge.mode.updateProvider.invoke({
          id: TRIAL_PROVIDER_ID_BY_VENDOR[vendor],
          api_key: access.device_token,
          base_url: access.base_url,
          models: access.models,
          enabled: true,
        });
        return { outcome: 'claimed', provider };
      } catch {
        return { outcome: 'already_claimed' };
      }
    }
    return { outcome: 'error' };
  }
}

/**
 * Claims a trial from `vendor` and materializes it as a normal, editable
 * local provider. `displayName` is the provider's `name` — callers pass an
 * already-translated string since this has no i18n context of its own.
 */
export async function claimTrialModel(vendor: TrialVendor, displayName: string): Promise<TrialClaimResult> {
  return isMeteredTrialVendor(vendor) ? claimMeteredAccount(vendor, displayName) : claimIssuedKey(displayName);
}

/**
 * Hook wrapper: tracks in-flight state and refreshes the shared providers SWR
 * cache on success so every provider list picks up the new row.
 */
export function useTrialModelClaim() {
  const { mutate } = useSWRConfig();
  const [claiming, setClaiming] = useState(false);

  const claim = useCallback(
    async (vendor: TrialVendor, displayName: string): Promise<TrialClaimResult> => {
      setClaiming(true);
      try {
        const result = await claimTrialModel(vendor, displayName);
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
