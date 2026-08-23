/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const preloadMock = vi.fn();
const listInvokeMock = vi.fn();

vi.mock('swr', () => ({
  preload: (...args: unknown[]) => preloadMock(...args),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      list: { invoke: (...args: unknown[]) => listInvokeMock(...args) },
    },
  },
}));

vi.mock('@/renderer/hooks/assistant/useAssistantList', () => ({
  ASSISTANTS_LIST_SWR_KEY: 'assistants.list',
}));

describe('prefetchAssistantsList', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    preloadMock.mockResolvedValue(undefined);
    listInvokeMock.mockResolvedValue([]);
    vi.stubGlobal('requestIdleCallback', undefined);
  });

  it('schedules a single idle preload for assistants.list', async () => {
    const idleCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: () => void) => {
        idleCallbacks.push(callback);
        return 1;
      })
    );

    const { prefetchAssistantsList } = await import('@/renderer/services/prefetchAssistantsList');

    prefetchAssistantsList();
    prefetchAssistantsList();

    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks[0]?.();

    expect(preloadMock).toHaveBeenCalledTimes(1);
    expect(preloadMock).toHaveBeenCalledWith('assistants.list', expect.any(Function));
  });

  it('allows retry after preload failure', async () => {
    vi.useFakeTimers();
    preloadMock.mockRejectedValueOnce(new Error('backend not ready')).mockResolvedValueOnce(undefined);

    const { prefetchAssistantsList } = await import('@/renderer/services/prefetchAssistantsList');

    prefetchAssistantsList();
    await vi.runAllTimersAsync();

    prefetchAssistantsList();
    await vi.runAllTimersAsync();

    expect(preloadMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
