/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where the team-resource purge is actually decided.
 *
 * The registry fetches can only guess from a status code, and 401 turned out
 * to be too weak to guess on: restarting the enterprise server invalidates
 * every outstanding token at once, so treating 401 as a revocation wiped the
 * team resources of every member who had done nothing wrong (measured on a
 * real client). Leaving the enterprise is the unambiguous signal, and it lives
 * here — but it has to fire on the TRANSITION, since a standalone user who was
 * never in an enterprise has nothing to purge.
 *
 * Also covers C1-2: `teamSkillSync.ts` cannot show UI itself (it is a plain
 * module with no React/i18n context), so it emits `enterprise.machineBlocked`
 * and this hook is the one that turns that into a message.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const {
  orgContext,
  clearTeamResources,
  listProviders,
  syncTeamSkills,
  syncTeamAgents,
  messageWarning,
  emitterHandlers,
} = vi.hoisted(() => ({
  orgContext: { current: { isEnterprise: false } },
  clearTeamResources: vi.fn(() => Promise.resolve()),
  listProviders: vi.fn(() => Promise.resolve([] as { managed_by?: string }[])),
  syncTeamSkills: vi.fn(() => Promise.resolve(null)),
  syncTeamAgents: vi.fn(() => Promise.resolve(null)),
  messageWarning: vi.fn(),
  // A trivial stand-in for the real emitter: the hook subscribes once per
  // mount, and tests trigger it directly instead of going through
  // `teamSkillSync.ts`'s actual emit site (that path is covered separately
  // by `purgeOnRevocation`'s own tests).
  emitterHandlers: new Map<string, () => void>(),
}));

vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: orgContext.current }),
}));

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));

// The purge now asks the backend whether any company-issued channel is still
// materialized, instead of trusting a localStorage marker that can go missing
// while the rows do not.
vi.mock('@/common', () => ({ ipcBridge: { mode: { listProviders: { invoke: listProviders } } } }));

// Explicitly OFF: the state a client is in after switching back to the personal
// workspace. A merely-unreachable server keeps this true and must not purge.
vi.mock('@/common/adapter/enterpriseMode', () => ({ isEnterpriseModeEnabled: () => false }));

vi.mock('@renderer/utils/enterprise/teamSkillSync', () => ({
  ENTERPRISE_RESOURCES_MARKER: 'one-enterprise:resources-materialized',
  clearTeamResources,
  syncContentInspection: vi.fn(() => Promise.resolve(null)),
  syncTeamAgents,
  syncTeamMcp: vi.fn(() => Promise.resolve(null)),
  syncTeamModelChannels: vi.fn(() => Promise.resolve(null)),
  syncTeamSkills,
  // The other governance surfaces that ride this timer: tool-call policy,
  // send policy, company memory, and the C0-1 upstream credential push. All
  // have to be here or the hook throws on the first tick.
  syncToolSecurityPolicy: vi.fn(() => Promise.resolve(true)),
  syncSendPolicy: vi.fn(() => Promise.resolve(true)),
  syncTeamMemory: vi.fn(() => Promise.resolve(0)),
  syncEnterpriseUpstream: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@renderer/utils/enterprise/conversationShare', () => ({
  fulfilAuditUploadRequests: vi.fn(() => Promise.resolve()),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { warning: messageWarning },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/utils/emitter', () => ({
  addEventListener: (event: string, fn: () => void) => {
    emitterHandlers.set(event, fn);
    return () => emitterHandlers.delete(event);
  },
}));

import { useTeamResourceSync } from '@/renderer/hooks/enterprise/useTeamResourceSync';

describe('useTeamResourceSync', () => {
  beforeEach(() => {
    clearTeamResources.mockClear();
    syncTeamSkills.mockClear();
    syncTeamAgents.mockClear();
    messageWarning.mockClear();
    emitterHandlers.clear();
    listProviders.mockReset();
    listProviders.mockResolvedValue([]);
    localStorage.clear();
    orgContext.current = { isEnterprise: false };
  });

  it('purges the local team resources when the member stops resolving as enterprise', () => {
    orgContext.current = { isEnterprise: true };
    const { rerender } = renderHook(() => useTeamResourceSync());
    expect(syncTeamAgents).toHaveBeenCalled();
    expect(clearTeamResources).not.toHaveBeenCalled();

    orgContext.current = { isEnterprise: false };
    rerender();

    expect(clearTeamResources).toHaveBeenCalledTimes(1);
  });

  it('purges nothing for a client that was never in an enterprise', () => {
    renderHook(() => useTeamResourceSync());

    expect(clearTeamResources).not.toHaveBeenCalled();
    expect(syncTeamSkills).not.toHaveBeenCalled();
  });

  it('syncs on entering enterprise mode, without purging first', () => {
    const { rerender } = renderHook(() => useTeamResourceSync());
    orgContext.current = { isEnterprise: true };
    rerender();

    expect(syncTeamSkills).toHaveBeenCalled();
    expect(clearTeamResources).not.toHaveBeenCalled();
  });

  it('purges a company channel the backend still holds even with no marker left', async () => {
    // The reported leak. The marker is renderer state and the rows are not:
    // rows written by an older build, or a marker consumed by a purge that
    // then failed, left the personal workspace showing an 「企业下发」 model
    // channel — the company's API key included — with nothing left that could
    // ever decide to remove it.
    listProviders.mockResolvedValue([{ managed_by: 'enterprise' }]);

    renderHook(() => useTeamResourceSync());
    await vi.waitFor(() => expect(clearTeamResources).toHaveBeenCalledTimes(1));
  });

  it('leaves an ordinary personal workspace alone', async () => {
    // The other half: asking the backend must not turn every personal-mode
    // start into a purge. Nothing company-issued, no marker, no purge.
    listProviders.mockResolvedValue([{ managed_by: undefined }]);

    renderHook(() => useTeamResourceSync());
    await vi.waitFor(() => expect(listProviders).toHaveBeenCalled());
    expect(clearTeamResources).not.toHaveBeenCalled();
  });

  it('keeps the marker when the purge fails, so the next start retries', async () => {
    localStorage.setItem('one-enterprise:resources-materialized', '1');
    clearTeamResources.mockRejectedValueOnce(new Error('backend unreachable'));

    renderHook(() => useTeamResourceSync());
    await vi.waitFor(() => expect(clearTeamResources).toHaveBeenCalledTimes(1));

    // The marker used to be removed before the purge was even started, so a
    // failed purge took its own retry with it and the rows stayed forever.
    expect(localStorage.getItem('one-enterprise:resources-materialized')).toBe('1');
  });

  it('clears the marker once the purge succeeds', async () => {
    localStorage.setItem('one-enterprise:resources-materialized', '1');

    renderHook(() => useTeamResourceSync());
    await vi.waitFor(() => expect(clearTeamResources).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(localStorage.getItem('one-enterprise:resources-materialized')).toBeNull());
  });

  it('C1-2: shows a warning message when this machine was blocked', () => {
    renderHook(() => useTeamResourceSync());

    const handler = emitterHandlers.get('enterprise.machineBlocked');
    expect(handler).toBeTypeOf('function');
    handler?.();

    expect(messageWarning).toHaveBeenCalledTimes(1);
    expect(messageWarning).toHaveBeenCalledWith('settings.enterpriseMachineBlockedNotice');
  });
});
