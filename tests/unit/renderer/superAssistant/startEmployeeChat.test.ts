/** @vitest-environment jsdom */
/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startChatMock, emitMock } = vi.hoisted(() => ({
  startChatMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: { personalAgent: { startChat: { invoke: (...args: unknown[]) => startChatMock(...args) } } },
}));

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: (...args: unknown[]) => emitMock(...args) } }));

import {
  resolveEmployeeStarterPrompts,
  startEmployeeChat,
} from '@/renderer/pages/superAssistant/utils/startEmployeeChat';

describe('startEmployeeChat', () => {
  beforeEach(() => {
    sessionStorage.clear();
    startChatMock.mockReset().mockResolvedValue({ runId: 'run_1', conversationId: 'conv_1' });
    emitMock.mockReset();
  });

  it('opens the bound conversation and queues the first message for whichever send box mounts', async () => {
    const navigate = vi.fn();
    await expect(startEmployeeChat('pa_1', navigate, '  Draft this week\'s report ')).resolves.toBe('conv_1');

    expect(startChatMock).toHaveBeenCalledWith({ agentId: 'pa_1' });
    const queued = JSON.stringify({ input: "Draft this week's report" });
    expect(sessionStorage.getItem('one_initial_message_conv_1')).toBe(queued);
    expect(sessionStorage.getItem('acp_initial_message_conv_1')).toBe(queued);
    expect(emitMock).toHaveBeenCalledWith('chat.history.refresh');
    expect(navigate).toHaveBeenCalledWith('/conversation/conv_1');
  });

  it('queues nothing when there is no first message — the member types the task there', async () => {
    const navigate = vi.fn();
    await startEmployeeChat('pa_1', navigate, '   ');
    expect(sessionStorage.length).toBe(0);
    expect(navigate).toHaveBeenCalledWith('/conversation/conv_1');
  });

  it('does not navigate when the backend refuses the chat', async () => {
    startChatMock.mockRejectedValue(new Error('404'));
    const navigate = vi.fn();
    await expect(startEmployeeChat('pa_gone', navigate, 'hi')).rejects.toThrow('404');
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
});

describe('resolveEmployeeStarterPrompts', () => {
  it('keeps trimmed non-empty strings, capped at four', () => {
    const prompts = ['  a ', '', 7, 'b', 'c', 'd', 'e'];
    expect(resolveEmployeeStarterPrompts({ automationConfig: { starterPrompts: prompts } })).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('is empty when the admin wrote none', () => {
    expect(resolveEmployeeStarterPrompts({ automationConfig: {} })).toEqual([]);
    expect(resolveEmployeeStarterPrompts({ automationConfig: { starterPrompts: 'nope' } })).toEqual([]);
  });
});
