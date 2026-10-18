/**
 * Copyright 2026 One Work
 */

/**
 * The send box's busy state comes from the runtime view, which only leaves
 * "running" on `turn.completed` or a hydrate. When a lagging socket is kicked
 * that frame can be the one dropped, so the view must re-hydrate from the
 * backend on `realtime.reconnected` — otherwise it stays "processing" for a
 * turn that already ended.
 */

import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({ reconnected: [] as Array<() => void> }));
const cache = vi.hoisted(() => ({ get: vi.fn(), getWithRetry: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getUserConversations: { invoke: vi.fn(() => new Promise(() => {})) } },
    conversation: {
      listChanged: { on: () => () => {} },
      responseStream: { on: () => () => {} },
      turnCompleted: { on: () => () => {} },
      confirmation: { remove: { on: () => () => {} } },
    },
    realtime: {
      reconnected: {
        on: (fn: () => void) => {
          handlers.reconnected.push(fn);
          return () => {
            handlers.reconnected = handlers.reconnected.filter((h) => h !== fn);
          };
        },
      },
    },
    application: { writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) } },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: cache.get,
  getConversationOrNullWithRetry: cache.getWithRetry,
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';

const runtime = (overrides: Partial<TConversationRuntimeSummary>): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: false,
  task_status: 'finished',
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
  ...overrides,
});

describe('useConversationRuntimeView after a realtime reconnect', () => {
  it('leaves "processing" when the backend says the turn already ended', async () => {
    cache.get.mockResolvedValue({
      id: 'conv-r',
      runtime: runtime({ state: 'running', can_send_message: false, is_processing: true, turn_id: 'turn-1' }),
    });
    const { result } = renderHook(() => useConversationRuntimeView('conv-r'));
    await waitFor(() => expect(result.current.isProcessing).toBe(true));

    cache.getWithRetry.mockResolvedValue({ id: 'conv-r', runtime: runtime({}) });
    await act(async () => {
      handlers.reconnected.forEach((h) => h());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isProcessing).toBe(false);
    expect(result.current.canSendMessage).toBe(true);
    expect(cache.getWithRetry).toHaveBeenCalledWith('conv-r');
  });

  it('stays "processing" when the turn is still running', async () => {
    const running = runtime({ state: 'running', can_send_message: false, is_processing: true, turn_id: 'turn-2' });
    cache.get.mockResolvedValue({ id: 'conv-s', runtime: running });
    const { result } = renderHook(() => useConversationRuntimeView('conv-s'));
    await waitFor(() => expect(result.current.isProcessing).toBe(true));

    cache.getWithRetry.mockResolvedValue({ id: 'conv-s', runtime: running });
    await act(async () => {
      handlers.reconnected.forEach((h) => h());
      await Promise.resolve();
    });

    expect(result.current.isProcessing).toBe(true);
  });
});
