/**
 * Copyright 2026 One Work
 */

import type { IProvider } from '@/common/config/storage';
import { isTrialProviderClaimed } from '@/renderer/hooks/agent/useTrialModelClaim';

/**
 * Model slug of the free router the OpenRouter trial hands out. A user who
 * already has this from any provider gains nothing from that side of the
 * offer.
 */
export const BUILT_IN_FREE_MODEL = 'openrouter/free';

const DISMISSED_KEY = 'trial-model-offer-dismissed';

/**
 * Whether showing the offer would tell the user something they already have.
 *
 * The empty-state offer is redundant once a usable model is configured,
 * including enterprise-issued providers. Disabled providers/models do not
 * count as usable configuration.
 */
export function isTrialOfferRedundant(providers: IProvider[] | undefined, enterpriseConnected = false): boolean {
  if (enterpriseConnected) return true;
  if (!providers?.length) return false;
  return (
    isTrialProviderClaimed(providers) ||
    providers.some(
      (provider) =>
        provider.enabled !== false && provider.models?.some((model) => provider.model_enabled?.[model] !== false)
    )
  );
}

/**
 * Dismissal persists across launches.
 *
 * It did not have to when the offer only appeared for users with no models at
 * all — those users need it, and it disappears the moment they have a model.
 * As a standing promotion shown to everyone who has not claimed, a dismissal
 * that comes back every launch is just nagging.
 */
export function readTrialOfferDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Private mode, cleared site data, a browser blocking storage — the offer
    // showing again is a far better failure than the page not rendering.
    return false;
  }
}

export function persistTrialOfferDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Best-effort: a failed write only means the offer returns next launch.
  }
}
