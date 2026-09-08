/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Carrying the send-rate limit and the model allowlist down to the machine
 * that actually sends.
 *
 * The failures worth guarding are the quiet ones — every case here ends with
 * the local backend holding a *wider* policy than the company set, which looks
 * exactly like a working client:
 *
 * 1. An unreadable plan being written down as "no allowlist", which would let
 *    every model through on every machine that happened to sync during an
 *    outage.
 * 2. An unreadable policy being written down as "no rate limit".
 * 3. An admin who genuinely cleared both being unable to express it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  mySecurityPolicy: vi.fn(),
  myPlan: vi.fn(),
  syncSendPolicy: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    onePlatform: { mySecurityPolicy: { invoke: hooks.mySecurityPolicy } },
    oneBilling: { myPlan: { invoke: hooks.myPlan } },
    mode: { syncSendPolicy: { invoke: hooks.syncSendPolicy } },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: vi.fn(() => 'https://company.example.com'),
}));

const { syncSendPolicy } = await import('@renderer/utils/enterprise/teamSkillSync');

beforeEach(() => {
  hooks.mySecurityPolicy.mockReset();
  hooks.myPlan.mockReset();
  hooks.syncSendPolicy.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('syncSendPolicy', () => {
  it('carries both limits down', async () => {
    hooks.mySecurityPolicy.mockResolvedValue({ conversationShareMode: 'tenant', sendRateLimitPerMinute: 5 });
    hooks.myPlan.mockResolvedValue({ allowedModels: ['glm-flash-latest', 'glm-latest'] });

    await expect(syncSendPolicy()).resolves.toBe(true);

    expect(hooks.syncSendPolicy).toHaveBeenCalledWith({
      sendRateLimitPerMinute: 5,
      allowedModels: ['glm-flash-latest', 'glm-latest'],
    });
  });

  it('lets an administrator clear both', async () => {
    hooks.mySecurityPolicy.mockResolvedValue({ conversationShareMode: 'tenant', sendRateLimitPerMinute: null });
    hooks.myPlan.mockResolvedValue({ allowedModels: [] });

    await expect(syncSendPolicy()).resolves.toBe(true);

    expect(hooks.syncSendPolicy).toHaveBeenCalledWith({ sendRateLimitPerMinute: null, allowedModels: [] });
  });

  it('leaves the local policy alone when the plan cannot be read', async () => {
    hooks.mySecurityPolicy.mockResolvedValue({ conversationShareMode: 'tenant', sendRateLimitPerMinute: 5 });
    hooks.myPlan.mockRejectedValue(new Error('network down'));

    await expect(syncSendPolicy()).resolves.toBe(false);

    // The dangerous alternative would be writing `allowedModels: []`, which
    // reads as "the administrator allows everything".
    expect(hooks.syncSendPolicy).not.toHaveBeenCalled();
  });

  it('leaves the local policy alone when the security policy cannot be read', async () => {
    hooks.mySecurityPolicy.mockRejectedValue(new Error('network down'));

    await expect(syncSendPolicy()).resolves.toBe(false);

    expect(hooks.myPlan).not.toHaveBeenCalled();
    expect(hooks.syncSendPolicy).not.toHaveBeenCalled();
  });
});
