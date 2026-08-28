/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const requestTrialKey = vi.fn();
const createProvider = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: {
      requestTrialKey: { invoke: (...args: unknown[]) => requestTrialKey(...args) },
      createProvider: { invoke: (...args: unknown[]) => createProvider(...args) },
    },
  },
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: (e: unknown) => typeof e === 'object' && e !== null && 'status' in e,
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  PROVIDERS_SWR_KEY: 'providers',
  fetchProviders: vi.fn(),
}));

import { claimTrialModel, isTrialProviderClaimed, TRIAL_PROVIDER_ID } from '@/renderer/hooks/agent/useTrialModelClaim';

const trialKey = {
  key: 'sk-test-key',
  base_url: 'https://vendor.example/v1',
  models: ['vendor/free'],
};

describe('claimTrialModel', () => {
  beforeEach(() => {
    requestTrialKey.mockReset();
    createProvider.mockReset();
    createProvider.mockResolvedValue({ id: TRIAL_PROVIDER_ID });
  });

  /**
   * The broker decides which upstream issued the key, so it is the broker that
   * names the platform. Hardcoding it here would silently mis-create the
   * provider the day the broker is repointed at a different token platform —
   * with no client release to catch it.
   */
  it('creates the provider on the platform the broker named', async () => {
    requestTrialKey.mockResolvedValue({ ...trialKey, platform: 'SomeOtherPlatform', vendor: 'other' });

    const result = await claimTrialModel('Trial');

    expect(result.outcome).toBe('claimed');
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'SomeOtherPlatform',
        base_url: 'https://vendor.example/v1',
        api_key: 'sk-test-key',
      })
    );
  });

  /** A broker deployed before the field existed still has to work. */
  it('falls back to OpenRouter when the broker sent no platform', async () => {
    requestTrialKey.mockResolvedValue(trialKey);

    await claimTrialModel('Trial');

    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ platform: 'OpenRouter' }));
  });

  it.each([
    [409, 'already_claimed'],
    [429, 'rate_limited'],
    [503, 'budget_exhausted'],
    [400, 'unavailable'],
  ])('maps a %i from the broker to %s', async (status, outcome) => {
    requestTrialKey.mockRejectedValue({ status });

    const result = await claimTrialModel('Trial');

    expect(result.outcome).toBe(outcome);
    expect(createProvider).not.toHaveBeenCalled();
  });

  /**
   * The broker has already minted and recorded the key by this point — dedup
   * is keyed on the install, not on whether the local row landed. So a
   * duplicate here reads as "already claimed" rather than as a failure.
   */
  it('treats a duplicate local provider as already claimed', async () => {
    requestTrialKey.mockResolvedValue(trialKey);
    createProvider.mockRejectedValue({ status: 409 });

    expect((await claimTrialModel('Trial')).outcome).toBe('already_claimed');
  });
});

describe('isTrialProviderClaimed', () => {
  it('recognises the trial provider by its fixed id', () => {
    expect(isTrialProviderClaimed([{ id: TRIAL_PROVIDER_ID }] as never)).toBe(true);
    expect(isTrialProviderClaimed([{ id: 'something-else' }] as never)).toBe(false);
    expect(isTrialProviderClaimed(undefined)).toBe(false);
  });
});
