/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The member-side half of company model channels.
 *
 * Two things here can hurt a user badly if they regress, and neither shows up
 * as an error when it does:
 *
 * 1. Sending `authoritative: true` on an incomplete set — the backend would
 *    then delete channels the member still has.
 * 2. Sending a vendor credential instead of the channel token — that would put
 *    the company's real key on every laptop, which is the exact thing this
 *    whole feature exists to avoid.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  listModelChannels: vi.fn(),
  issueChannelToken: vi.fn(),
  syncModelChannels: vi.fn(),
  syncTeamSkills: vi.fn(),
  syncTeamMcp: vi.fn(),
  // `clearTeamResources` also clears distributed content rules (T4). Stubbed
  // here only so this file's model-channel assertions can run — the behaviour
  // itself is asserted in syncContentInspection.test.ts.
  setContentInspectionRules: vi.fn(),
  getEnterpriseServerUrl: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneDevops: {
      listModelChannels: { invoke: hooks.listModelChannels },
      issueChannelToken: { invoke: hooks.issueChannelToken },
      listSkills: { invoke: vi.fn() },
      listMcpRegistry: { invoke: vi.fn() },
    },
    mode: {
      syncModelChannels: { invoke: hooks.syncModelChannels },
      setContentInspectionRules: { invoke: hooks.setContentInspectionRules },
    },
    fs: {
      syncTeamSkills: { invoke: hooks.syncTeamSkills },
      syncTeamMcp: { invoke: hooks.syncTeamMcp },
    },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: hooks.getEnterpriseServerUrl,
}));

const { syncTeamModelChannels, clearTeamResources } = await import('@renderer/utils/enterprise/teamSkillSync');

const channel = (id: string, name: string, enabled = true) => ({
  id,
  name,
  platform: 'openai',
  upstreamBaseUrl: 'https://api.openai.com',
  hasKey: true,
  models: '["gpt-image-2"]',
  modelSettings: null,
  enabled,
  scope: 'org',
  teamId: null,
  visibility: 'all',
  createdBy: 'admin',
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(() => {
  hooks.getEnterpriseServerUrl.mockReturnValue('https://one.corp.example');
  hooks.syncModelChannels.mockResolvedValue({ written: [], removed: [], conflicts: [] });
  hooks.issueChannelToken.mockImplementation(async ({ id }: { id: string }) => ({
    channelId: id,
    token: `onech-${id}`,
  }));
  hooks.syncTeamSkills.mockResolvedValue({ written: [], removed: [], kept: 0 });
  hooks.syncTeamMcp.mockResolvedValue({ written: [], removed: [], kept: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('syncTeamModelChannels', () => {
  it('materializes a channel as a provider pointed at the company proxy', async () => {
    hooks.listModelChannels.mockResolvedValueOnce([channel('ochan_1', 'corp-gateway')]);

    await syncTeamModelChannels();

    const payload = hooks.syncModelChannels.mock.calls[0][0];
    expect(payload.authoritative).toBe(true);
    expect(payload.channels).toEqual([
      {
        channelId: 'ochan_1',
        name: 'corp-gateway',
        platform: 'openai',
        baseUrl: 'https://one.corp.example/api/one/model-proxy/ochan_1',
        token: 'onech-ochan_1',
        models: ['gpt-image-2'],
        modelSettings: undefined,
      },
    ]);
  });

  // The credential the member ends up holding must be the revocable token, and
  // the upstream vendor URL must not be what they talk to.
  it('never sends a vendor URL or anything but the channel token', async () => {
    hooks.listModelChannels.mockResolvedValueOnce([channel('ochan_1', 'corp-gateway')]);

    await syncTeamModelChannels();

    const [{ channels }] = hooks.syncModelChannels.mock.calls[0];
    expect(channels[0].baseUrl).not.toContain('api.openai.com');
    expect(channels[0].token).toMatch(/^onech-/);
  });

  it('skips channels the admin disabled', async () => {
    hooks.listModelChannels.mockResolvedValueOnce([channel('ochan_1', 'on'), channel('ochan_2', 'off', false)]);

    await syncTeamModelChannels();

    const [{ channels }] = hooks.syncModelChannels.mock.calls[0];
    expect(channels.map((c: { name: string }) => c.name)).toEqual(['on']);
  });

  // Offline-first: a registry we could not read must leave local providers
  // alone, or a member whose server blipped watches their models vanish.
  it('does nothing at all when the registry cannot be read', async () => {
    hooks.listModelChannels.mockRejectedValueOnce(new Error('offline'));

    await expect(syncTeamModelChannels()).resolves.toBeNull();
    expect(hooks.syncModelChannels).not.toHaveBeenCalled();
  });

  // The subtler version of the same rule: the list arrived, but a token did
  // not. That set is incomplete, so reconciling against it would delete a
  // channel the member still has.
  it('does not claim to be authoritative when a token could not be minted', async () => {
    hooks.listModelChannels.mockResolvedValueOnce([channel('ochan_1', 'a'), channel('ochan_2', 'b')]);
    hooks.issueChannelToken.mockImplementationOnce(async () => {
      throw new Error('not entitled');
    });

    await syncTeamModelChannels();

    const payload = hooks.syncModelChannels.mock.calls[0][0];
    expect(payload.authoritative).toBe(false);
    expect(payload.channels).toHaveLength(1);
  });

  it('stays authoritative when every channel resolved', async () => {
    hooks.listModelChannels.mockResolvedValueOnce([channel('ochan_1', 'a'), channel('ochan_2', 'b')]);

    await syncTeamModelChannels();

    expect(hooks.syncModelChannels.mock.calls[0][0].authoritative).toBe(true);
  });

  // Without a server address there is no proxy to point at, and a guessed base
  // URL would produce a provider that fails at call time for no visible reason.
  it('declines to write anything when no company server is configured', async () => {
    hooks.getEnterpriseServerUrl.mockReturnValue(null);
    hooks.listModelChannels.mockResolvedValueOnce([channel('ochan_1', 'corp')]);

    await expect(syncTeamModelChannels()).resolves.toBeNull();
    expect(hooks.syncModelChannels).not.toHaveBeenCalled();
  });
});

describe('clearTeamResources', () => {
  // A member who left must not keep calling the company's models.
  it('clears provisioned model channels along with skills and MCP', async () => {
    await clearTeamResources();

    expect(hooks.syncModelChannels).toHaveBeenCalledWith({ channels: [], authoritative: true });
  });
});
