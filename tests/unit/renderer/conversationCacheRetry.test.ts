/**
 * Copyright 2026 One Work
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: get } } } }));
vi.mock('swr', () => ({ mutate: vi.fn() }));

import { getConversationOrNullWithRetry } from '@/renderer/pages/conversation/utils/conversationCache';

describe('getConversationOrNullWithRetry', () => {
  afterEach(() => {
    get.mockReset();
  });

  it('retries a transient failure and returns the eventual answer', async () => {
    get.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ id: 'c1' });

    await expect(getConversationOrNullWithRetry('c1', [0, 0])).resolves.toEqual({ id: 'c1' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last delay and surfaces the error', async () => {
    get.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getConversationOrNullWithRetry('c1', [0, 0])).rejects.toThrow('Failed to fetch');
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('does not retry a missing conversation', async () => {
    const { BackendHttpError } = await import('@/common/adapter/httpBridge');
    get.mockRejectedValue(
      new BackendHttpError({ method: 'GET', path: '/x', status: 404, body: { code: 'NOT_FOUND', error: 'gone' } })
    );

    await expect(getConversationOrNullWithRetry('c1', [0, 0])).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
