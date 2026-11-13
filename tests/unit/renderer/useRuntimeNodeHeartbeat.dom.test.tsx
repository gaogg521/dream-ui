/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const heartbeat = vi.fn();
const getIdentity = vi.fn();
const getManagedAgents = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    application: { getRuntimeNodeIdentity: { invoke: (...a: unknown[]) => getIdentity(...a) } },
    oneAdmin: { runtimeHeartbeat: { invoke: (...a: unknown[]) => heartbeat(...a) } },
    acpConversation: { getManagedAgents: { invoke: (...a: unknown[]) => getManagedAgents(...a) } },
  },
}));

vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: { isEnterprise: true } }),
}));

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));

import { useRuntimeNodeHeartbeat } from '@renderer/hooks/enterprise/useRuntimeNodeHeartbeat';

describe('useRuntimeNodeHeartbeat installedAgents', () => {
  beforeEach(() => {
    heartbeat.mockReset().mockResolvedValue(undefined);
    getIdentity.mockReset().mockResolvedValue({ machineId: 'm-1', hostname: 'PC-1', ipAddresses: ['10.0.0.2'] });
    getManagedAgents.mockReset();
  });

  it('reports only agents the local backend marks installed, de-duplicated', async () => {
    getManagedAgents.mockResolvedValue([
      { name: 'Claude Code', backend: 'claude', installed: true },
      { name: 'Codex', backend: 'codex', installed: false },
      { name: 'Claude Code', backend: 'claude', installed: true },
      { name: '', backend: 'gemini', installed: true },
    ]);
    renderHook(() => useRuntimeNodeHeartbeat());
    await waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(1));
    expect(heartbeat.mock.calls[0][0]).toMatchObject({
      machineId: 'm-1',
      installedAgents: ['Claude Code', 'gemini'],
    });
  });

  it('still heartbeats with an empty list when the agent catalog lookup fails', async () => {
    getManagedAgents.mockRejectedValue(new Error('backend not ready'));
    renderHook(() => useRuntimeNodeHeartbeat());
    await waitFor(() => expect(heartbeat).toHaveBeenCalledTimes(1));
    expect(heartbeat.mock.calls[0][0]).toMatchObject({ machineId: 'm-1', installedAgents: [] });
  });
});
