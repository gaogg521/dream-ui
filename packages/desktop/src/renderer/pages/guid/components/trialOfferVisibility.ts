/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
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
 * Two ways that can be true, and both matter:
 *  - any trial provider (either vendor) is present, i.e. they claimed one here;
 *  - *any* provider already serves the free model, e.g. they added their own
 *    OpenRouter key by hand. The offer would hand them a second route to
 *    models they can already reach.
 *
 * Checking only a trial provider id would nag exactly the users who went to
 * the trouble of configuring one themselves.
 */
export function isTrialOfferRedundant(providers: IProvider[] | undefined): boolean {
  if (!providers?.length) return false;
  return (
    isTrialProviderClaimed(providers) || providers.some((provider) => provider.models?.includes(BUILT_IN_FREE_MODEL))
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
