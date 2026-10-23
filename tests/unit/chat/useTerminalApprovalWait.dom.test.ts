/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A terminal call held for a company administrator's approval shows up as a
 * status in the conversation that owns it — and only that conversation, and
 * only until that same task is decided.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler<T> = (event: T) => void;
type Pending = { conversationId: string; taskId: string; command: string; startedAtMs: number; expiresAtMs: number };
type Resolved = { conversationId: string; taskId: string; outcome: 'approved' | 'denied' | 'failed' };

const handlers: { pending: Handler<Pending>[]; resolved: Handler<Resolved>[] } = { pending: [], resolved: [] };

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      approvalPending: {
        on: (handler: Handler<Pending>) => {
          handlers.pending.push(handler);
          return () => {
            handlers.pending = handlers.pending.filter((h) => h !== handler);
          };
        },
      },
      approvalResolved: {
        on: (handler: Handler<Resolved>) => {
          handlers.resolved.push(handler);
          return () => {
            handlers.resolved = handlers.resolved.filter((h) => h !== handler);
          };
        },
      },
    },
  },
}));

import { useTerminalApprovalWait } from '@/renderer/hooks/chat/useTerminalApprovalWait';

const pending = (over: Partial<Pending> = {}): Pending => ({
  conversationId: 'conv-1',
  taskId: 'task-1',
  command: 'Get-ChildItem -Force',
  startedAtMs: 1000,
  expiresAtMs: 601000,
  ...over,
});

const emitPending = (event: Pending) => handlers.pending.forEach((h) => h(event));
const emitResolved = (event: Resolved) => handlers.resolved.forEach((h) => h(event));

describe('useTerminalApprovalWait', () => {
  beforeEach(() => {
    handlers.pending = [];
    handlers.resolved = [];
  });

  it('is idle until a terminal call is held', () => {
    const { result } = renderHook(() => useTerminalApprovalWait('conv-1'));
    expect(result.current).toBeNull();
  });

  it('reports the held command for its own conversation', () => {
    const { result } = renderHook(() => useTerminalApprovalWait('conv-1'));
    act(() => emitPending(pending()));
    expect(result.current).toMatchObject({ taskId: 'task-1', command: 'Get-ChildItem -Force' });
  });

  it('ignores another conversation, in both directions', () => {
    const { result } = renderHook(() => useTerminalApprovalWait('conv-1'));
    act(() => emitPending(pending({ conversationId: 'conv-2' })));
    expect(result.current).toBeNull();

    act(() => emitPending(pending()));
    act(() => emitResolved({ conversationId: 'conv-2', taskId: 'task-1', outcome: 'approved' }));
    expect(result.current).not.toBeNull();
  });

  it('clears when that task is decided, whatever the outcome', () => {
    for (const outcome of ['approved', 'denied', 'failed'] as const) {
      const { result } = renderHook(() => useTerminalApprovalWait('conv-1'));
      act(() => emitPending(pending()));
      act(() => emitResolved({ conversationId: 'conv-1', taskId: 'task-1', outcome }));
      expect(result.current).toBeNull();
    }
  });

  it('keeps a newer wait when a late resolve arrives for an older task', () => {
    const { result } = renderHook(() => useTerminalApprovalWait('conv-1'));
    act(() => emitPending(pending({ taskId: 'task-2', command: 'dir' })));
    act(() => emitResolved({ conversationId: 'conv-1', taskId: 'task-1', outcome: 'approved' }));
    expect(result.current).toMatchObject({ taskId: 'task-2' });
  });

  it('shows a long, multi-line command as one short line', () => {
    const { result } = renderHook(() => useTerminalApprovalWait('conv-1'));
    act(() => emitPending(pending({ command: `line one\n  line two ${'x'.repeat(200)}` })));
    const command = result.current?.command ?? '';
    expect(command).not.toContain('\n');
    expect(command.length).toBeLessThanOrEqual(81);
    expect(command.startsWith('line one line two')).toBe(true);
  });

  it('stops listening when unmounted and starts clean for a new conversation', () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useTerminalApprovalWait(id), {
      initialProps: { id: 'conv-1' },
    });
    act(() => emitPending(pending()));
    expect(result.current).not.toBeNull();

    rerender({ id: 'conv-2' });
    expect(result.current).toBeNull();

    unmount();
    expect(handlers.pending).toHaveLength(0);
    expect(handlers.resolved).toHaveLength(0);
  });
});
