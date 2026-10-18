/**
 * Copyright 2026 One Work
 */

/**
 * When the backend kicks a lagging socket, the frames it dropped can include a
 * turn's terminal frame — the only thing that clears a sidebar spinner. On
 * `realtime.reconnected` the store re-checks every spinning row against the
 * backend and clears the ones whose turn has ended, leaving live turns alone.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({ reconnected: undefined as undefined | (() => void) }));
const getWithRetry = vi.hoisted(() => vi.fn());

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
          handlers.reconnected = fn;
          return () => {};
        },
      },
    },
    application: { writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) } },
  },
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNullWithRetry: getWithRetry,
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import {
  reconcileGeneratingFromRuntime,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

describe('sidebar spinner after a realtime reconnect', () => {
  it('clears rows whose turn ended and keeps rows still running', async () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => {
      reconcileGeneratingFromRuntime('ended', true);
      reconcileGeneratingFromRuntime('running', true);
      reconcileGeneratingFromRuntime('deleted', true);
    });
    getWithRetry.mockImplementation((id: string) =>
      Promise.resolve(id === 'deleted' ? null : { id, runtime: { is_processing: id === 'running' } })
    );

    await act(async () => {
      handlers.reconnected?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isConversationGenerating('ended')).toBe(false);
    expect(result.current.isConversationGenerating('deleted')).toBe(false);
    expect(result.current.isConversationGenerating('running')).toBe(true);
  });

  it('leaves the spinner alone when the re-check fails', async () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => {
      reconcileGeneratingFromRuntime('unreachable', true);
    });
    getWithRetry.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      handlers.reconnected?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isConversationGenerating('unreachable')).toBe(true);
  });
});
