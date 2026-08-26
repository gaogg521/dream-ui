/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 捕获各 run 事件订阅回调，供测试手动推送事件。vi.mock 会被提升,所以这里用 vi.hoisted。
const { getRunStateMock, listeners, makeEventChannel } = vi.hoisted(() => {
  const hoistedListeners: Record<string, (event: unknown) => void> = {};
  return {
    getRunStateMock: vi.fn(),
    listeners: hoistedListeners,
    makeEventChannel: (name: string) => ({
      on: (cb: (event: unknown) => void) => {
        hoistedListeners[name] = cb;
        return vi.fn();
      },
    }),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      getRunState: { invoke: (...args: unknown[]) => getRunStateMock(...args) },
      runAccepted: makeEventChannel('runAccepted'),
      runStarted: makeEventChannel('runStarted'),
      runUpdated: makeEventChannel('runUpdated'),
      runCompleted: makeEventChannel('runCompleted'),
      runCancelled: makeEventChannel('runCancelled'),
      runFailed: makeEventChannel('runFailed'),
      childTurnStarted: makeEventChannel('childTurnStarted'),
      childTurnCompleted: makeEventChannel('childTurnCompleted'),
      childTurnCancelled: makeEventChannel('childTurnCancelled'),
      slotWorkChanged: makeEventChannel('slotWorkChanged'),
      listChanged: makeEventChannel('listChanged'),
      sessionChanged: makeEventChannel('sessionChanged'),
      agentSpawned: makeEventChannel('agentSpawned'),
      agentRemoved: makeEventChannel('agentRemoved'),
      agentRenamed: makeEventChannel('agentRenamed'),
      sessionStatusChanged: makeEventChannel('sessionStatusChanged'),
      agentStatusChanged: makeEventChannel('agentStatusChanged'),
    },
    realtime: {
      reconnected: makeEventChannel('reconnected'),
    },
  },
}));

import { useTeamRunView } from '@/renderer/pages/team/hooks/useTeamRunView';

describe('useTeamRunView', () => {
  beforeEach(() => {
    getRunStateMock.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  it('indexes slot_work from run events', async () => {
    getRunStateMock.mockResolvedValue({ active_run: null, slot_work: [] });
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(getRunStateMock).toHaveBeenCalled());

    act(() => {
      listeners.runUpdated?.({
        team_id: 'team-1',
        team_run_id: 'run-1',
        status: 'running',
        slot_work: [{ slot_id: 'slot-a', state: 'working' }],
      });
    });

    expect(result.current.state.activeRun?.team_run_id).toBe('run-1');
    expect(result.current.state.slotWorkBySlot['slot-a']).toEqual({ slot_id: 'slot-a', state: 'working' });
  });

  it('tolerates run events without slot_work from older backends (< v0.1.45)', async () => {
    getRunStateMock.mockResolvedValue({ active_run: null, slot_work: [] });
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(getRunStateMock).toHaveBeenCalled());

    // 旧后端的 run 事件没有 slot_work 字段——不应抛异常导致整树卸载(白屏)。
    act(() => {
      listeners.runUpdated?.({ team_id: 'team-1', team_run_id: 'run-1', status: 'running' });
    });
    expect(result.current.state.activeRun?.team_run_id).toBe('run-1');
    expect(result.current.state.slotWorkBySlot).toEqual({});

    act(() => {
      listeners.runCompleted?.({ team_id: 'team-1', team_run_id: 'run-1', status: 'completed' });
    });
    expect(result.current.state.activeRun).toBeUndefined();
    expect(result.current.state.slotWorkBySlot).toEqual({});
  });

  it('tolerates a reconcile snapshot without slot_work', async () => {
    getRunStateMock.mockResolvedValue({ active_run: null });
    const { result } = renderHook(() => useTeamRunView('team-1'));

    await waitFor(() => expect(getRunStateMock).toHaveBeenCalled());
    expect(result.current.state.slotWorkBySlot).toEqual({});
  });

  it('marks the session stopped on idle-cleanup reclaim and clears it on recovery', async () => {
    getRunStateMock.mockResolvedValue({ active_run: null, slot_work: [] });
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(getRunStateMock).toHaveBeenCalled());
    expect(result.current.state.sessionStopped).toBe(false);

    act(() => {
      listeners.sessionStatusChanged?.({ team_id: 'team-1', status: 'stopped' });
    });
    expect(result.current.state.sessionStopped).toBe(true);

    act(() => {
      listeners.sessionStatusChanged?.({ team_id: 'team-1', status: 'ready' });
    });
    expect(result.current.state.sessionStopped).toBe(false);
  });

  it('ignores sessionStatusChanged events for a different team', async () => {
    getRunStateMock.mockResolvedValue({ active_run: null, slot_work: [] });
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(getRunStateMock).toHaveBeenCalled());

    act(() => {
      listeners.sessionStatusChanged?.({ team_id: 'team-other', status: 'stopped' });
    });
    expect(result.current.state.sessionStopped).toBe(false);
  });

  it('self-heals sessionStopped when a new active run event lands', async () => {
    getRunStateMock.mockResolvedValue({ active_run: null, slot_work: [] });
    const { result } = renderHook(() => useTeamRunView('team-1'));
    await waitFor(() => expect(getRunStateMock).toHaveBeenCalled());

    act(() => {
      listeners.sessionStatusChanged?.({ team_id: 'team-1', status: 'stopped' });
    });
    expect(result.current.state.sessionStopped).toBe(true);

    act(() => {
      listeners.runUpdated?.({
        team_id: 'team-1',
        team_run_id: 'run-1',
        status: 'running',
        slot_work: [],
      });
    });
    expect(result.current.state.sessionStopped).toBe(false);
  });
});
