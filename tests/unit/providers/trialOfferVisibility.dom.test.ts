/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  BUILT_IN_FREE_MODEL,
  isTrialOfferRedundant,
  readTrialOfferDismissed,
  persistTrialOfferDismissed,
} from '@/renderer/pages/guid/components/trialOfferVisibility';
import { TRIAL_PROVIDER_ID } from '@/renderer/hooks/agent/useTrialModelClaim';

const provider = (id: string, models: string[] = []) => ({ id, models }) as never;

describe('isTrialOfferRedundant', () => {
  it('shows the offer to someone with no providers at all', () => {
    expect(isTrialOfferRedundant(undefined)).toBe(false);
    expect(isTrialOfferRedundant([])).toBe(false);
  });

  it('hides it once the trial provider is present', () => {
    expect(isTrialOfferRedundant([provider(TRIAL_PROVIDER_ID, [BUILT_IN_FREE_MODEL])])).toBe(true);
  });

  /**
   * The point of the offer is access to the free models. Someone who wired up
   * their own OpenRouter key already has them, so showing it would nag exactly
   * the users who went to the most trouble.
   */
  it('hides it when any provider already serves the free model', () => {
    expect(isTrialOfferRedundant([provider('my-own-openrouter', ['openrouter/free', 'z-ai/glm-5.3-flash'])])).toBe(
      true
    );
  });

  /** Providers that offer other models are not a substitute. */
  it('still shows it to someone whose providers lack the free model', () => {
    expect(isTrialOfferRedundant([provider('openai', ['gpt-5']), provider('custom', ['doubao-seed-evolving'])])).toBe(
      false
    );
  });

  it('tolerates a provider with no model list', () => {
    expect(isTrialOfferRedundant([{ id: 'broken' } as never])).toBe(false);
  });
});

describe('trial offer dismissal', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  /**
   * Dismissal has to survive a relaunch. It did not need to when the offer
   * only appeared for users with no models — it disappears on its own the
   * moment they have one. As a standing promotion, a dismissal that comes back
   * every launch is just nagging.
   */
  it('persists across a reload', () => {
    expect(readTrialOfferDismissed()).toBe(false);
    persistTrialOfferDismissed();
    expect(readTrialOfferDismissed()).toBe(true);
  });

  /**
   * Private mode, cleared site data, or a browser blocking storage all throw
   * here. Showing the offer again is a far better failure than the page not
   * rendering.
   */
  it('treats unreadable storage as not dismissed rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(() => readTrialOfferDismissed()).not.toThrow();
    expect(readTrialOfferDismissed()).toBe(false);
  });

  it('swallows a failed write rather than breaking the dismiss click', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    expect(() => persistTrialOfferDismissed()).not.toThrow();
  });
});
