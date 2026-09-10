/**
 * @license
 * Copyright 2026 1ONE
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
  listProviders: vi.fn(),
  syncModelChannels: vi.fn(),
  syncTeamSkills: vi.fn(),
  syncTeamMcp: vi.fn(),
  syncTeamAgents: vi.fn(),
  // `clearTeamResources` also clears distributed content rules (T4). Stubbed
  // here only so this file's model-channel assertions can run — the behaviour
  // itself is asserted in syncContentInspection.test.ts.
  setContentInspectionRules: vi.fn(),
  getEnterpriseServerUrl: vi.fn(),
  clearEnterpriseUpstream: vi.fn(),
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
      listProviders: { invoke: hooks.listProviders },
      clearEnterpriseUpstream: { invoke: hooks.clearEnterpriseUpstream },
      // The rest of what `clearTeamResources` takes back. Stubbed rather than
      // asserted here — `teamResourceRevocation.dom.test.ts` owns the
      // sink-by-sink check. They still have to EXIST: the purge builds its
      // `Promise.allSettled` array eagerly, so a missing bridge entry throws on
      // the `.invoke` property access before any promise is created, and the
      // whole purge rejects.
      syncToolSecurityPolicy: { invoke: vi.fn().mockResolvedValue(undefined) },
      syncSendPolicy: { invoke: vi.fn().mockResolvedValue(undefined) },
      syncTeamMemory: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
    fs: {
      syncTeamSkills: { invoke: hooks.syncTeamSkills },
      syncTeamMcp: { invoke: hooks.syncTeamMcp },
    },
    personalAgent: {
      listTeamAgents: { invoke: vi.fn() },
      syncTeamAgents: { invoke: hooks.syncTeamAgents },
    },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: hooks.getEnterpriseServerUrl,
}));

const { BackendHttpError } = await import('@/common/adapter/httpBridge');
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
  // No local rows is the first-sync case; individual tests override it.
  hooks.listProviders.mockResolvedValue([]);
  hooks.syncTeamSkills.mockResolvedValue({ written: [], removed: [], kept: 0 });
  hooks.syncTeamMcp.mockResolvedValue({ written: [], removed: [], kept: 0 });
  hooks.clearEnterpriseUpstream.mockResolvedValue(undefined);
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

/**
 * Minting rotates: the server keeps only a hash, so a second call replaces the
 * row and kills the first token. Since this sync runs on a five-minute timer,
 * minting every cycle meant a member's own client invalidated the credential
 * that its running agents were already holding — reproduced on a real client
 * as `401 not authorized for this model channel` on any conversation left open
 * past one cycle.
 */
describe('channel tokens across repeated syncs', () => {
  // A channel id of its own per case: the cache is module state, so reusing an
  // id another test already minted for would make these pass for free.
  let CACHE_ID = 'ochan_cache_a';

  it('mints once and reuses it on later cycles', async () => {
    CACHE_ID = 'ochan_cache_a';
    hooks.listModelChannels.mockResolvedValue([channel(CACHE_ID, 'corp-gateway')]);

    await syncTeamModelChannels();
    await syncTeamModelChannels();
    await syncTeamModelChannels();

    expect(hooks.issueChannelToken).toHaveBeenCalledTimes(1);
    // And every sync still writes the provider with a working token, rather
    // than skipping the write because it had nothing new to mint.
    expect(hooks.syncModelChannels).toHaveBeenCalledTimes(3);
    for (const call of hooks.syncModelChannels.mock.calls) {
      expect(call[0].channels[0].token).toBe(`onech-${CACHE_ID}`);
    }
  });

  /**
   * The in-memory map dies with the page; the agent holding the token does
   * not — it lives in the co-located backend. So a reload must not re-mint,
   * and the only thing that survives both is the local provider row.
   */
  it('reuses the token the local backend already stores instead of rotating', async () => {
    CACHE_ID = 'ochan_cache_c';
    hooks.listModelChannels.mockResolvedValue([channel(CACHE_ID, 'corp-gateway')]);
    hooks.listProviders.mockResolvedValue([{ id: `prov_chan_${CACHE_ID}`, api_key: 'onech-already-issued' }]);

    await syncTeamModelChannels();

    expect(hooks.issueChannelToken).not.toHaveBeenCalled();
    expect(hooks.syncModelChannels.mock.calls.at(-1)?.[0].channels[0].token).toBe('onech-already-issued');
  });

  it('drops the cached token when the member is revoked', async () => {
    CACHE_ID = 'ochan_cache_b';
    hooks.listModelChannels.mockResolvedValue([channel(CACHE_ID, 'corp-gateway')]);
    await syncTeamModelChannels();
    expect(hooks.issueChannelToken).toHaveBeenCalledTimes(1);

    // A 403 anywhere in the team sync means the membership is gone; the cached
    // company credential must not outlive it.
    hooks.listModelChannels.mockRejectedValueOnce(
      new BackendHttpError({
        method: 'GET',
        path: '/api/one/devops/model-channels',
        status: 403,
        body: { code: 'FORBIDDEN', error: 'not a member' },
      })
    );
    await syncTeamModelChannels();

    hooks.listModelChannels.mockResolvedValue([channel(CACHE_ID, 'corp-gateway')]);
    await syncTeamModelChannels();
    expect(hooks.issueChannelToken).toHaveBeenCalledTimes(2);
  });
});

describe('clearTeamResources', () => {
  // A member who left must not keep calling the company's models.
  it('clears provisioned model channels along with skills and MCP', async () => {
    await clearTeamResources();

    expect(hooks.syncModelChannels).toHaveBeenCalledWith({ channels: [], authoritative: true });
  });
});
