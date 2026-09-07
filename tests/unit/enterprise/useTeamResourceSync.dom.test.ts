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
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { orgContext, clearTeamResources, syncTeamSkills, syncTeamAgents } = vi.hoisted(() => ({
  orgContext: { current: { isEnterprise: false } },
  clearTeamResources: vi.fn(() => Promise.resolve()),
  syncTeamSkills: vi.fn(() => Promise.resolve(null)),
  syncTeamAgents: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: orgContext.current }),
}));

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));

vi.mock('@renderer/utils/enterprise/teamSkillSync', () => ({
  clearTeamResources,
  syncContentInspection: vi.fn(() => Promise.resolve(null)),
  syncTeamAgents,
  syncTeamMcp: vi.fn(() => Promise.resolve(null)),
  syncTeamModelChannels: vi.fn(() => Promise.resolve(null)),
  syncTeamSkills,
  // The other two governance surfaces that ride this timer: the tool-call
  // policy and the company memory. Both enforce on the local backend for the
  // same reason the content rules do, so both have to be here or the hook
  // throws on the first tick.
  syncToolSecurityPolicy: vi.fn(() => Promise.resolve(true)),
  syncTeamMemory: vi.fn(() => Promise.resolve(0)),
}));

import { useTeamResourceSync } from '@/renderer/hooks/enterprise/useTeamResourceSync';

describe('useTeamResourceSync', () => {
  beforeEach(() => {
    clearTeamResources.mockClear();
    syncTeamSkills.mockClear();
    syncTeamAgents.mockClear();
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
});
