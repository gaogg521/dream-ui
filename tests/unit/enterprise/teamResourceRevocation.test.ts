/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What happens to locally materialized team resources when the org stops
 * recognising this client.
 *
 * Every registry fetch is offline-first: a server it cannot reach leaves the
 * local cache alone, so a member does not watch their skills vanish during a
 * blip. But the same catch-all swallowed a 401/403, which is not an outage —
 * it is the server refusing this client. So an admin removing a member left
 * every team skill and MCP connector materialized on that machine,
 * auto-loading into their agent indefinitely; the only purge that ever ran was
 * the one behind the member's own "exit enterprise" button, i.e. exactly the
 * case where governance did not need it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  listMcpRegistry: vi.fn(),
  listModelChannels: vi.fn(),
  issueChannelToken: vi.fn(),
  syncTeamSkills: vi.fn(),
  syncTeamMcp: vi.fn(),
  syncModelChannels: vi.fn(),
  setContentInspectionRules: vi.fn(),
  getEnterpriseServerUrl: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneDevops: {
      listSkills: { invoke: hooks.listSkills },
      listMcpRegistry: { invoke: hooks.listMcpRegistry },
      listModelChannels: { invoke: hooks.listModelChannels },
      issueChannelToken: { invoke: hooks.issueChannelToken },
    },
    fs: {
      syncTeamSkills: { invoke: hooks.syncTeamSkills },
      syncTeamMcp: { invoke: hooks.syncTeamMcp },
    },
    mode: {
      syncModelChannels: { invoke: hooks.syncModelChannels },
      setContentInspectionRules: { invoke: hooks.setContentInspectionRules },
    },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: hooks.getEnterpriseServerUrl,
}));

const { BackendHttpError } = await import('@/common/adapter/httpBridge');
const { syncTeamSkills, syncTeamMcp, syncTeamModelChannels } = await import('@renderer/utils/enterprise/teamSkillSync');

const refusal = (status: number) =>
  new BackendHttpError({
    method: 'GET',
    path: '/api/one/devops/skills',
    status,
    body: { code: 'FORBIDDEN', error: 'not a member' },
  });

/** Did the purge run? It is the empty authoritative write on all three sinks. */
const purged = () =>
  hooks.syncTeamSkills.mock.calls.some(([arg]) => arg.authoritative && arg.skills.length === 0) &&
  hooks.syncTeamMcp.mock.calls.some(([arg]) => arg.authoritative && arg.servers.length === 0) &&
  hooks.syncModelChannels.mock.calls.some(([arg]) => arg.authoritative && arg.channels.length === 0);

beforeEach(() => {
  for (const fn of Object.values(hooks)) fn.mockReset();
  hooks.getEnterpriseServerUrl.mockReturnValue('https://one.corp.example');
  hooks.syncTeamSkills.mockResolvedValue({ written: [], removed: [], kept: 0 });
  hooks.syncTeamMcp.mockResolvedValue({ written: [], removed: [], kept: 0 });
  hooks.syncModelChannels.mockResolvedValue({ written: [], removed: [], conflicts: [] });
  hooks.setContentInspectionRules.mockResolvedValue(undefined);
});

describe('team resources when membership is refused', () => {
  it.each([
    ['skills', 403],
    ['skills', 401],
  ])('purges everything when the %s registry answers %i', async (_which, status) => {
    hooks.listSkills.mockRejectedValue(refusal(status));

    await expect(syncTeamSkills()).resolves.toBeNull();

    expect(purged()).toBe(true);
  });

  it('purges when the MCP registry refuses', async () => {
    hooks.listMcpRegistry.mockRejectedValue(refusal(403));
    await expect(syncTeamMcp()).resolves.toBeNull();
    expect(purged()).toBe(true);
  });

  it('purges when the model-channel registry refuses', async () => {
    hooks.listModelChannels.mockRejectedValue(refusal(401));
    await expect(syncTeamModelChannels()).resolves.toBeNull();
    expect(purged()).toBe(true);
  });

  it('keeps the cache when the server is merely unreachable', async () => {
    // The offline-first promise: a member on a train keeps their team skills.
    hooks.listSkills.mockRejectedValue(new TypeError('fetch failed'));

    await expect(syncTeamSkills()).resolves.toBeNull();

    expect(hooks.syncTeamSkills).not.toHaveBeenCalled();
    expect(hooks.syncTeamMcp).not.toHaveBeenCalled();
    expect(hooks.syncModelChannels).not.toHaveBeenCalled();
  });

  it('keeps the cache on a server-side failure that is not a refusal', async () => {
    hooks.listSkills.mockRejectedValue(refusal(500));
    await expect(syncTeamSkills()).resolves.toBeNull();
    expect(hooks.syncTeamSkills).not.toHaveBeenCalled();
  });

  it('purges once per revocation, not once per registry that noticed it', async () => {
    hooks.listSkills.mockRejectedValue(refusal(403));
    hooks.listMcpRegistry.mockRejectedValue(refusal(403));
    hooks.listModelChannels.mockRejectedValue(refusal(403));

    // One sync cycle: all three registries refuse at once.
    await Promise.all([syncTeamSkills(), syncTeamMcp(), syncTeamModelChannels()]);

    expect(hooks.syncTeamSkills).toHaveBeenCalledTimes(1);
  });
});
