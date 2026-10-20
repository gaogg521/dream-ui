/**
 * Copyright 2026 One Work
 */

/**
 * `responseStream` asks for a list refresh on every frame of a conversation the
 * list does not know yet. With a slow list endpoint that used to fire one
 * full-list request per streamed token; they piled up past Chromium's
 * per-renderer limit and every fetch in the window then failed with
 * net::ERR_INSUFFICIENT_RESOURCES. The store must keep at most one request in
 * flight (plus one queued behind it), and a failed refresh must not forget the
 * conversations it already knew.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type StreamFrame = { conversation_id: string; type: string; turn_id?: string };
type ListResult = { items: Array<{ id: string; name: string; extra?: Record<string, unknown> }> };

const handlers = vi.hoisted(() => ({
  responseStream: undefined as undefined | ((frame: StreamFrame) => void),
}));
const pending = vi.hoisted(() => [] as Array<{ resolve: (v: ListResult) => void; reject: (e: unknown) => void }>);
const invoke = vi.hoisted(() =>
  vi.fn(
    () =>
      new Promise<ListResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      })
  )
);

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getUserConversations: { invoke } },
    conversation: {
      listChanged: { on: () => () => {} },
      responseStream: {
        on: (fn: (frame: StreamFrame) => void) => {
          handlers.responseStream = fn;
          return () => {};
        },
      },
      turnCompleted: { on: () => () => {} },
      confirmation: { remove: { on: () => () => {} } },
    },
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import { BackendHttpError } from '@/common/adapter/httpBridge';
import {
  getSnapshotConversationName,
  resetConversationRefreshStateForTest,
  retryLoadConversations,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('conversation list refresh', () => {
  beforeEach(() => {
    resetConversationRefreshStateForTest();
  });

  it('coalesces a burst of unknown-conversation frames into one request plus one trailing refresh', async () => {
    renderHook(() => useConversationListSync());
    // Store init issues the first refresh; it stays in flight.
    expect(invoke).toHaveBeenCalledTimes(1);

    act(() => {
      for (let i = 0; i < 500; i++) {
        handlers.responseStream?.({ conversation_id: 'conv-new', type: 'content' });
      }
    });
    expect(invoke).toHaveBeenCalledTimes(1);

    pending.shift()?.resolve({ items: [{ id: 'conv-old', name: 'Old' }] });
    await flush();
    // Exactly one trailing refresh for everything that arrived meanwhile.
    expect(invoke).toHaveBeenCalledTimes(2);

    pending.shift()?.resolve({
      items: [
        { id: 'conv-old', name: 'Old' },
        { id: 'conv-new', name: 'New' },
      ],
    });
    await flush();
    expect(invoke).toHaveBeenCalledTimes(2);

    // Now known: further frames do not ask for a refresh at all.
    act(() => {
      handlers.responseStream?.({ conversation_id: 'conv-new', type: 'content' });
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(getSnapshotConversationName('conv-new')).toBe('New');
  });

  it('keeps the last good list when a refresh fails', async () => {
    renderHook(() => useConversationListSync());
    const before = invoke.mock.calls.length;

    act(() => {
      handlers.responseStream?.({ conversation_id: 'conv-unknown', type: 'content' });
    });
    expect(invoke).toHaveBeenCalledTimes(before + 1);

    pending.shift()?.reject(new TypeError('Failed to fetch'));
    await flush();

    // The known list survives, so frames of known conversations stay quiet.
    expect(getSnapshotConversationName('conv-new')).toBe('New');
    act(() => {
      handlers.responseStream?.({ conversation_id: 'conv-old', type: 'content' });
    });
    expect(invoke).toHaveBeenCalledTimes(before + 1);
  });

  it('reports why the list could not be loaded, and clears the report once it can', async () => {
    const { result } = renderHook(() => useConversationListSync());
    // Drain anything the previous case left in flight, then start from a good load.
    await flush();
    while (pending.length > 0) pending.shift()?.resolve({ items: [] });
    await flush();
    act(() => retryLoadConversations());
    pending.shift()?.resolve({ items: [] });
    await flush();
    expect(result.current.listLoadError).toBeNull();

    act(() => retryLoadConversations());
    pending.shift()?.reject(
      new BackendHttpError({
        method: 'GET',
        path: '/api/conversations',
        status: 503,
        body: { code: 'DATABASE_CORRUPT', error: 'The local database file is damaged.' },
      })
    );
    await flush();
    expect(result.current.listLoadError?.code).toBe('DATABASE_CORRUPT');

    // A plain network failure carries no code, so the sidebar offers a retry instead.
    act(() => retryLoadConversations());
    pending.shift()?.reject(new TypeError('Failed to fetch'));
    await flush();
    expect(result.current.listLoadError).toEqual({ code: null, message: 'Failed to fetch' });

    act(() => retryLoadConversations());
    pending.shift()?.resolve({ items: [{ id: 'conv-ok', name: 'Ok' }] });
    await flush();
    expect(result.current.listLoadError).toBeNull();
  });
});
