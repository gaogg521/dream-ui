/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The member-side half of company content inspection (T4).
 *
 * The failures worth guarding here are the ones that look like nothing is
 * wrong:
 *
 * 1. An unreachable server clearing the local rules — the policy would stop
 *    applying, with no error anywhere.
 * 2. An empty rule list being treated as a failure — an admin who deletes
 *    every rule would find them still enforced.
 * 3. Findings being dropped when the report call fails — they were already
 *    drained from the backend, so nothing else holds them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  listMyDlpRules: vi.fn(),
  reportDlpEvents: vi.fn(),
  setContentInspectionRules: vi.fn(),
  drainContentInspectionFindings: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneDevops: {
      listMyDlpRules: { invoke: hooks.listMyDlpRules },
      reportDlpEvents: { invoke: hooks.reportDlpEvents },
      listSkills: { invoke: vi.fn() },
      listMcpRegistry: { invoke: vi.fn() },
      listModelChannels: { invoke: vi.fn() },
      issueChannelToken: { invoke: vi.fn() },
    },
    mode: {
      setContentInspectionRules: { invoke: hooks.setContentInspectionRules },
      drainContentInspectionFindings: { invoke: hooks.drainContentInspectionFindings },
      syncModelChannels: { invoke: vi.fn() },
    },
    fs: {
      syncTeamSkills: { invoke: vi.fn() },
      syncTeamMcp: { invoke: vi.fn() },
    },
    oneOrg: { listEnterpriseTenants: { invoke: vi.fn() } },
  },
}));

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: vi.fn(() => 'https://company.example.com'),
}));

const { syncContentInspection, clearTeamResources } = await import('@renderer/utils/enterprise/teamSkillSync');

const rule = (id: string) => ({
  id,
  name: `rule-${id}`,
  matcher: 'keyword' as const,
  pattern: 'secret',
  action: 'log' as const,
  enabled: true,
  scope: 'org',
  teamId: null,
  createdBy: 'admin',
  createdAt: 0,
  updatedAt: 0,
});

const finding = (ruleId: string) => ({
  conversationId: 'c1',
  model: null,
  ruleId,
  ruleName: `rule-${ruleId}`,
  action: 'log',
  hits: 1,
  excerpt: 'the se****et plan',
});

beforeEach(() => {
  hooks.listMyDlpRules.mockReset();
  hooks.reportDlpEvents.mockReset();
  hooks.setContentInspectionRules.mockReset();
  hooks.drainContentInspectionFindings.mockReset();

  hooks.setContentInspectionRules.mockResolvedValue({ activeRules: 0 });
  hooks.drainContentInspectionFindings.mockResolvedValue([]);
  hooks.reportDlpEvents.mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('syncContentInspection', () => {
  it('distributes the rules the member is subject to', async () => {
    hooks.listMyDlpRules.mockResolvedValue([rule('r1'), rule('r2')]);
    hooks.setContentInspectionRules.mockResolvedValue({ activeRules: 2 });

    const result = await syncContentInspection();

    expect(result).toEqual({ rules: 2, findingsReported: 0 });
    const sent = hooks.setContentInspectionRules.mock.calls[0][0];
    expect(sent.rules.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2']);
  });

  it('leaves the local rules alone when the server cannot be reached', async () => {
    hooks.listMyDlpRules.mockRejectedValue(new Error('offline'));

    expect(await syncContentInspection()).toBeNull();
    expect(hooks.setContentInspectionRules).not.toHaveBeenCalled();
  });

  it('treats an empty list as authoritative, not as a failure', async () => {
    hooks.listMyDlpRules.mockResolvedValue([]);

    await syncContentInspection();

    expect(hooks.setContentInspectionRules).toHaveBeenCalledWith({ rules: [] });
  });

  it('ships the findings this machine recorded back to the company', async () => {
    hooks.listMyDlpRules.mockResolvedValue([rule('r1')]);
    hooks.drainContentInspectionFindings.mockResolvedValue([finding('r1')]);

    const result = await syncContentInspection();

    expect(result?.findingsReported).toBe(1);
    expect(hooks.reportDlpEvents).toHaveBeenCalledWith({ events: [finding('r1')] });
  });

  it('retries findings whose report failed instead of losing them', async () => {
    hooks.listMyDlpRules.mockResolvedValue([rule('r1')]);
    hooks.drainContentInspectionFindings.mockResolvedValue([finding('r1')]);
    hooks.reportDlpEvents.mockRejectedValueOnce(new Error('server down'));

    // First cycle: drained locally, report failed. The backend's buffer is
    // already empty, so nothing but this retry holds them.
    expect((await syncContentInspection())?.findingsReported).toBe(0);

    // Second cycle: nothing new drained, but the earlier finding must still go.
    hooks.drainContentInspectionFindings.mockResolvedValue([]);
    hooks.reportDlpEvents.mockResolvedValue(1);

    expect((await syncContentInspection())?.findingsReported).toBe(1);
    expect(hooks.reportDlpEvents).toHaveBeenLastCalledWith({ events: [finding('r1')] });
  });

  it('stops enforcing company rules once the member leaves', async () => {
    // Nothing server-side can retract a rule that already reached this machine.
    // Without this, a departing member keeps getting sends refused by their
    // ex-employer's policy, on a screen that no longer exists to explain it.
    await clearTeamResources();

    expect(hooks.setContentInspectionRules).toHaveBeenCalledWith({ rules: [] });
  });

  it('drops undelivered findings on leaving instead of reporting to the ex-company', async () => {
    hooks.listMyDlpRules.mockResolvedValue([rule('r1')]);
    hooks.drainContentInspectionFindings.mockResolvedValue([finding('r1')]);
    hooks.reportDlpEvents.mockRejectedValueOnce(new Error('server down'));
    await syncContentInspection();

    await clearTeamResources();

    // Re-joining a company later must not ship the previous one's findings.
    hooks.drainContentInspectionFindings.mockResolvedValue([]);
    hooks.reportDlpEvents.mockClear();
    hooks.reportDlpEvents.mockResolvedValue(0);
    await syncContentInspection();

    expect(hooks.reportDlpEvents).not.toHaveBeenCalled();
  });

  it('does not re-send a finding that was already delivered', async () => {
    hooks.listMyDlpRules.mockResolvedValue([rule('r1')]);
    hooks.drainContentInspectionFindings.mockResolvedValue([finding('r1')]);
    await syncContentInspection();

    hooks.drainContentInspectionFindings.mockResolvedValue([]);
    hooks.reportDlpEvents.mockClear();

    await syncContentInspection();
    expect(hooks.reportDlpEvents).not.toHaveBeenCalled();
  });
});
