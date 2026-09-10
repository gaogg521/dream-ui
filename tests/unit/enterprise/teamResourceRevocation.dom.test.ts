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
  listTeamAgents: vi.fn(),
  syncTeamAgents: vi.fn(),
  getEnterpriseServerUrl: vi.fn(),
  emitterEmit: vi.fn(),
  clearEnterpriseUpstream: vi.fn(),
  syncToolSecurityPolicy: vi.fn(),
  syncSendPolicy: vi.fn(),
  syncTeamMemory: vi.fn(),
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
    personalAgent: {
      listTeamAgents: { invoke: hooks.listTeamAgents },
      syncTeamAgents: { invoke: hooks.syncTeamAgents },
    },
    mode: {
      syncModelChannels: { invoke: hooks.syncModelChannels },
      setContentInspectionRules: { invoke: hooks.setContentInspectionRules },
      clearEnterpriseUpstream: { invoke: hooks.clearEnterpriseUpstream },
      syncToolSecurityPolicy: { invoke: hooks.syncToolSecurityPolicy },
      syncSendPolicy: { invoke: hooks.syncSendPolicy },
      syncTeamMemory: { invoke: hooks.syncTeamMemory },
    },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: hooks.getEnterpriseServerUrl,
}));

// C1-2: `purgeOnRevocation` emits through this on the machine-blocked path so
// `useTeamResourceSync` (a real React hook, no context here) can show a
// message. This module is otherwise side-effect-free, so mocking only `emit`
// is enough to assert on it.
vi.mock('@renderer/utils/emitter', () => ({
  emitter: { emit: hooks.emitterEmit },
}));

const { BackendHttpError } = await import('@/common/adapter/httpBridge');
const { syncTeamSkills, syncTeamMcp, syncTeamModelChannels } = await import('@renderer/utils/enterprise/teamSkillSync');

const refusal = (status: number, code = 'FORBIDDEN') =>
  new BackendHttpError({
    method: 'GET',
    path: '/api/one/devops/skills',
    status,
    body: { code, error: 'not a member' },
  });

/** C1-2: the server still answers 403 for a blocked machine, distinguished
 * only by this code — see `isMachineBlockedError` in `teamSkillSync.ts`. */
const machineBlocked = () => refusal(403, 'MACHINE_BLOCKED');

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
  hooks.syncTeamAgents.mockResolvedValue({ written: [], removed: [], kept: 0 });
  hooks.clearEnterpriseUpstream.mockResolvedValue(undefined);
  hooks.syncToolSecurityPolicy.mockResolvedValue(undefined);
  hooks.syncSendPolicy.mockResolvedValue(undefined);
  hooks.syncTeamMemory.mockResolvedValue(undefined);
});

/**
 * Everything `useTeamResourceSync`'s `syncAll` pushes down, and therefore
 * everything leaving has to take back.
 *
 * Kept as an explicit list because the two halves live in different files and
 * drifted once already: the three policies added with the C0-1/C1-1 work were
 * wired into `syncAll` and not into the purge, so an ex-employer's
 * destructive-command block, send rate limit, model allowlist and memory items
 * outlived the membership. Nothing surfaced it — the disconnect toggle only
 * reloads the renderer, the co-located backend holds all three in memory until
 * the app fully restarts, and by then the enterprise UI is gone and no screen
 * explains why terminal commands are refused or company memory keeps
 * surfacing. The disconnect dialog meanwhile promises "本机个人数据不受影响".
 */
const PURGE_SINKS: ReadonlyArray<[string, () => ReturnType<typeof vi.fn>]> = [
  ['team skills', () => hooks.syncTeamSkills],
  ['team MCP', () => hooks.syncTeamMcp],
  ['model channels', () => hooks.syncModelChannels],
  ['team agents', () => hooks.syncTeamAgents],
  ['content inspection rules', () => hooks.setContentInspectionRules],
  ['company-server channel', () => hooks.clearEnterpriseUpstream],
  ['tool-call security policy', () => hooks.syncToolSecurityPolicy],
  ['send policy', () => hooks.syncSendPolicy],
  ['team memory', () => hooks.syncTeamMemory],
];

describe('leaving the enterprise takes back everything it pushed', () => {
  it('clears every sink syncAll writes to', async () => {
    const { clearTeamResources } = await import('@renderer/utils/enterprise/teamSkillSync');

    await clearTeamResources();

    const untouched = PURGE_SINKS.filter(([, sink]) => sink().mock.calls.length === 0).map(([name]) => name);
    expect(untouched).toEqual([]);
  });

  it('clears the two policies to their permissive value, not a lockout', async () => {
    const { clearTeamResources } = await import('@renderer/utils/enterprise/teamSkillSync');

    await clearTeamResources();

    // An all-false tool policy and a null/empty send policy are the
    // unrestricted state — `dream_core_system::send_policy` is explicit that
    // "Empty is unrestricted". Clearing to anything else would leave a
    // departed member locked out of their own machine.
    expect(hooks.syncToolSecurityPolicy).toHaveBeenCalledWith({
      destructiveCommandsBlocked: false,
      blockedCommandPatterns: [],
      externalNetworkDeniedByDefault: false,
      terminalToolsRequireApproval: false,
    });
    expect(hooks.syncSendPolicy).toHaveBeenCalledWith({ sendRateLimitPerMinute: null, allowedModels: [] });
    expect(hooks.syncTeamMemory).toHaveBeenCalledWith({ recallEnabled: false, items: [] });
  });
});

describe('team resources when membership is refused', () => {
  it('purges everything when the skills registry answers 403', async () => {
    hooks.listSkills.mockRejectedValue(refusal(403));

    await expect(syncTeamSkills()).resolves.toBeNull();

    expect(purged()).toBe(true);
  });

  // 401 used to purge too. Measured on a real client: restarting the
  // enterprise server invalidates every outstanding token, so every member —
  // none of them revoked — lost their team resources at once. "I do not know
  // who you are" is not "you may not have this"; the genuine revocation is
  // caught on the org-context transition instead (see useTeamResourceSync).
  it('keeps the cache on 401 — an expired session is not a revocation', async () => {
    hooks.listSkills.mockRejectedValue(refusal(401));

    await expect(syncTeamSkills()).resolves.toBeNull();

    expect(hooks.syncTeamSkills).not.toHaveBeenCalled();
    expect(hooks.syncTeamMcp).not.toHaveBeenCalled();
    expect(hooks.syncModelChannels).not.toHaveBeenCalled();
  });

  it('purges when the MCP registry refuses', async () => {
    hooks.listMcpRegistry.mockRejectedValue(refusal(403));
    await expect(syncTeamMcp()).resolves.toBeNull();
    expect(purged()).toBe(true);
  });

  it('purges when the model-channel registry refuses', async () => {
    hooks.listModelChannels.mockRejectedValue(refusal(403));
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

describe('C1-2: a blocked machine', () => {
  it('is purged exactly like a removed member — still a 403, distinguished only by the code', async () => {
    hooks.listSkills.mockRejectedValue(machineBlocked());

    await expect(syncTeamSkills()).resolves.toBeNull();

    expect(purged()).toBe(true);
  });

  it('emits enterprise.machineBlocked so the UI can show why', async () => {
    hooks.listSkills.mockRejectedValue(machineBlocked());

    await syncTeamSkills();

    expect(hooks.emitterEmit).toHaveBeenCalledWith('enterprise.machineBlocked');
  });

  it('emits once per revocation, not once per registry that noticed it', async () => {
    hooks.listSkills.mockRejectedValue(machineBlocked());
    hooks.listMcpRegistry.mockRejectedValue(machineBlocked());
    hooks.listModelChannels.mockRejectedValue(machineBlocked());

    await Promise.all([syncTeamSkills(), syncTeamMcp(), syncTeamModelChannels()]);

    expect(hooks.emitterEmit).toHaveBeenCalledTimes(1);
  });

  it('does not emit for a plain membership refusal — only the machine-blocked code triggers the message', async () => {
    hooks.listSkills.mockRejectedValue(refusal(403));

    await syncTeamSkills();

    expect(purged()).toBe(true);
    expect(hooks.emitterEmit).not.toHaveBeenCalled();
  });
});
