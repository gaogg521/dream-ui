/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const requestTrialKey = vi.fn();
const meteredClaim = vi.fn();
const createProvider = vi.fn();
const updateProvider = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: {
      requestTrialKey: { invoke: (...args: unknown[]) => requestTrialKey(...args) },
      meteredClaim: { invoke: (...args: unknown[]) => meteredClaim(...args) },
      createProvider: { invoke: (...args: unknown[]) => createProvider(...args) },
      updateProvider: { invoke: (...args: unknown[]) => updateProvider(...args) },
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

import {
  claimMeteredAccount,
  claimTrialModel,
  isToppableVendor,
  isTrialProviderClaimed,
  TRIAL_PROVIDER_ID,
  TRIAL_PROVIDER_ID_BY_VENDOR,
} from '@/renderer/hooks/agent/useTrialModelClaim';

const trialKey = { key: 'sk-test-key', base_url: 'https://vendor.example/v1', models: ['vendor/free'] };
const meteredAccess = {
  vendor: 'baoyun',
  base_url: 'https://broker.example/v1/metered/proxy/baoyun',
  device_token: 'dtk_abc',
  models: ['deepseek-chat'],
  currency: 'CNY',
  free_grant_cents: 1000,
  remaining_cents: 1000,
};

describe('claimTrialModel — openrouter (mode A)', () => {
  beforeEach(() => {
    requestTrialKey.mockReset();
    createProvider.mockReset().mockResolvedValue({ id: TRIAL_PROVIDER_ID });
  });

  it('creates the provider on the platform the broker named', async () => {
    requestTrialKey.mockResolvedValue({ ...trialKey, platform: 'SomeOtherPlatform', vendor: 'other' });

    const result = await claimTrialModel('openrouter', 'Trial');

    expect(result.outcome).toBe('claimed');
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'SomeOtherPlatform',
        base_url: 'https://vendor.example/v1',
        api_key: 'sk-test-key',
      })
    );
  });

  it('falls back to OpenRouter when the broker sent no platform', async () => {
    requestTrialKey.mockResolvedValue(trialKey);
    await claimTrialModel('openrouter', 'Trial');
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ platform: 'OpenRouter' }));
  });

  it.each([
    [404, 'unavailable'],
    [409, 'already_claimed'],
    [429, 'rate_limited'],
    [503, 'budget_exhausted'],
    [400, 'unavailable'],
  ])('maps a %i from the broker to %s', async (status, outcome) => {
    requestTrialKey.mockRejectedValue({ status });
    const result = await claimTrialModel('openrouter', 'Trial');
    expect(result.outcome).toBe(outcome);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('treats a duplicate local provider as already claimed', async () => {
    requestTrialKey.mockResolvedValue(trialKey);
    createProvider.mockRejectedValue({ status: 409 });
    expect((await claimTrialModel('openrouter', 'Trial')).outcome).toBe('already_claimed');
  });
});

describe('claimTrialModel — baoyun (mode A, since 2026-09-20)', () => {
  beforeEach(() => {
    requestTrialKey.mockReset();
    createProvider.mockReset().mockResolvedValue({ id: TRIAL_PROVIDER_ID_BY_VENDOR.baoyun });
  });

  it('claims through the issued-key path, not the metered one', async () => {
    requestTrialKey.mockResolvedValue({ ...trialKey, platform: 'custom', vendor: 'baoyun', currency: 'CNY' });

    const result = await claimTrialModel('baoyun', 'Baoyun trial');

    expect(requestTrialKey).toHaveBeenCalledWith({ vendor: 'baoyun' });
    expect(meteredClaim).not.toHaveBeenCalled();
    expect(result.outcome).toBe('claimed');
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trial-baoyun',
        platform: 'custom',
        base_url: trialKey.base_url,
        api_key: trialKey.key,
      })
    );
  });

  it("falls back to 'custom' when the broker sent no platform", async () => {
    requestTrialKey.mockResolvedValue(trialKey);
    await claimTrialModel('baoyun', 'Baoyun trial');
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({ platform: 'custom' }));
  });

  it.each([
    [404, 'unavailable'],
    [409, 'already_claimed'],
    [429, 'rate_limited'],
    [503, 'budget_exhausted'],
    [400, 'unavailable'],
  ])('maps a %i from the broker to %s', async (status, outcome) => {
    requestTrialKey.mockRejectedValue({ status });
    const result = await claimTrialModel('baoyun', 'Baoyun trial');
    expect(result.outcome).toBe(outcome);
    expect(createProvider).not.toHaveBeenCalled();
  });
});

// Mode B is not currently reachable through `claimTrialModel` for any vendor
// (`METERED_TRIAL_VENDORS` is empty — see the module doc: it's kept ready for
// a future vendor that genuinely cannot issue a capped key). Exercised
// directly here so that code path stays covered while unreachable.
describe('claimMeteredAccount (mode B, currently unreachable via claimTrialModel)', () => {
  beforeEach(() => {
    meteredClaim.mockReset().mockResolvedValue(meteredAccess);
    createProvider.mockReset().mockResolvedValue({ id: TRIAL_PROVIDER_ID_BY_VENDOR.baoyun });
    updateProvider.mockReset().mockResolvedValue({ id: TRIAL_PROVIDER_ID_BY_VENDOR.baoyun });
  });

  it('materializes the metered account as a custom provider pointed at the broker proxy', async () => {
    const result = await claimMeteredAccount('baoyun', 'Baoyun trial');

    expect(meteredClaim).toHaveBeenCalledWith({ vendor: 'baoyun' });
    expect(result.outcome).toBe('claimed');
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trial-baoyun',
        platform: 'custom',
        base_url: meteredAccess.base_url,
        api_key: 'dtk_abc',
      })
    );
  });

  it('overwrites the stale local provider when a re-claim rotated the token', async () => {
    createProvider.mockRejectedValue({ status: 409 });

    const result = await claimMeteredAccount('baoyun', 'Baoyun trial');

    expect(result.outcome).toBe('claimed');
    expect(updateProvider).toHaveBeenCalledWith(expect.objectContaining({ id: 'trial-baoyun', api_key: 'dtk_abc' }));
  });

  it.each([
    [404, 'unavailable'],
    [400, 'unavailable'],
    [429, 'rate_limited'],
  ])('maps a %i from the broker to %s', async (status, outcome) => {
    meteredClaim.mockRejectedValue({ status });
    const result = await claimMeteredAccount('baoyun', 'Baoyun trial');
    expect(result.outcome).toBe(outcome);
    expect(createProvider).not.toHaveBeenCalled();
  });
});

describe('isTrialProviderClaimed', () => {
  it('recognises either vendor by its fixed id', () => {
    expect(isTrialProviderClaimed([{ id: TRIAL_PROVIDER_ID }] as never)).toBe(true);
    expect(isTrialProviderClaimed([{ id: 'trial-baoyun' }] as never)).toBe(true);
    expect(isTrialProviderClaimed([{ id: 'something-else' }] as never)).toBe(false);
    expect(isTrialProviderClaimed(undefined)).toBe(false);
  });

  it('scopes to one vendor when asked', () => {
    expect(isTrialProviderClaimed([{ id: 'trial-baoyun' }] as never, 'baoyun')).toBe(true);
    expect(isTrialProviderClaimed([{ id: 'trial-baoyun' }] as never, 'openrouter')).toBe(false);
  });
});

// Which vendor accepts a real-money top-up order is a separate question from
// which vendor is on mode B (`isMeteredTrialVendor`) — they currently
// coincide on Baoyun only by chance, not by definition.
describe('isToppableVendor', () => {
  it('is true only for baoyun, the one vendor whose account API has a top-up endpoint', () => {
    expect(isToppableVendor('baoyun')).toBe(true);
    expect(isToppableVendor('openrouter')).toBe(false);
  });
});
