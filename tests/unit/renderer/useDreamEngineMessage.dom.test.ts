/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDreamEngineMessage } from '@/renderer/pages/conversation/platforms/dreamEngine/useDreamEngineMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { resetConversationTurnClockForTests } from '@/renderer/pages/conversation/utils/conversationTurnClock';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';

const {
  reportClientTurnUsageMock,
  addOrUpdateMessageMock,
  conversationUpdateInvokeMock,
  conversationGetUsageInvokeMock,
  responseStreamOnMock,
  responseStreamHandlerRef,
} = vi.hoisted(() => ({
  reportClientTurnUsageMock: vi.fn(),
  addOrUpdateMessageMock: vi.fn(),
  conversationUpdateInvokeMock: vi.fn(),
  // The hook now hydrates the context meter from the backend's usage
  // snapshot; without this the mount effect throws on an undefined bridge
  // method and every case in this file fails on an unrelated assertion.
  conversationGetUsageInvokeMock: vi.fn(),
  responseStreamOnMock: vi.fn(),
  responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => addOrUpdateMessageMock,
  useMergeLiveMessage: () => addOrUpdateMessageMock,
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/renderer/utils/enterprise/clientUsageReport', () => ({
  reportClientTurnUsage: reportClientTurnUsageMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
      update: {
        invoke: conversationUpdateInvokeMock,
      },
      getUsage: {
        invoke: conversationGetUsageInvokeMock,
      },
      // The usage query is chained after the runtime is up (asking before the
      // task exists gets a null), so the hook now reaches for this too.
      ensureRuntime: {
        invoke: () => Promise.resolve({}),
      },
    },
  },
}));

describe('useDreamEngineMessage turn clock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationTurnClockForTests();
    conversationUpdateInvokeMock.mockResolvedValue(undefined);
    // No snapshot is the normal case for a conversation that has not run a
    // turn; the hook treats it as "nothing to restore".
    conversationGetUsageInvokeMock.mockResolvedValue(undefined);
    responseStreamHandlerRef.current = undefined;
  });

  it('preserves the turn start timestamp when switching away and back to a running conversation', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result, rerender } = renderHook(({ id }) => useDreamEngineMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // User sends a message at t=100s — the send box flips waitingResponse on.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);

    // Switch to another conversation while the backend keeps processing conv-1.
    vi.mocked(getConversationOrNull).mockImplementation((id: string) =>
      Promise.resolve(id === 'conv-1' ? ({ runtime: { is_processing: true } } as never) : null)
    );
    nowSpy.mockReturnValue(200_000);
    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });
    expect(result.current.turnStartedAtMs).toBeNull();

    // Switch back — hydration restores processing state with the ORIGINAL start
    // time, so the elapsed indicator does not restart from zero.
    rerender({ id: 'conv-1' });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();
  });

  it('keeps the persisted origin when entering a running conversation from an idle one', async () => {
    // conv-2 recorded an origin during its own send earlier in the session.
    vi.mocked(getConversationOrNull).mockImplementation((id: string) =>
      Promise.resolve(id === 'conv-2' ? ({ runtime: { is_processing: true } } as never) : null)
    );

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const first = renderHook(() => useDreamEngineMessage('conv-2'));
    await waitFor(() => {
      expect(first.result.current.running).toBe(true);
    });
    expect(first.result.current.turnStartedAtMs).toBe(100_000);
    first.unmount();

    // A fresh mount starts on an idle conversation, then navigates to conv-2.
    nowSpy.mockReturnValue(250_000);
    const { result, rerender } = renderHook(({ id }) => useDreamEngineMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.running).toBe(false);

    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();
  });

  it('drops a stale turn start timestamp when hydration reports the conversation idle', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result, rerender } = renderHook(({ id }) => useDreamEngineMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();

    // Turn ends while the user is on another conversation: switching back finds
    // the backend idle, so the recorded origin must be discarded.
    rerender({ id: 'conv-2' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
      expect(result.current.running).toBe(false);
    });
    rerender({ id: 'conv-1' });
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });
    expect(result.current.running).toBe(false);
    expect(result.current.turnStartedAtMs).toBeNull();

    // A later turn starts from its own send time, not the stale origin.
    const nowSpy2 = vi.spyOn(Date, 'now').mockReturnValue(500_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(500_000);
    nowSpy2.mockRestore();
  });

  it('clears the turn start timestamp when the turn finishes', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);

    const { result } = renderHook(() => useDreamEngineMessage('conv-1'));
    await waitFor(() => {
      expect(result.current.hasHydratedRunningState).toBe(true);
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(100_000);

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        conversation_id: 'conv-1',
      } as unknown as IResponseMessage);
    });
    expect(result.current.running).toBe(false);
    expect(result.current.turnStartedAtMs).toBeNull();

    // The next turn gets a fresh origin instead of inheriting the stale one.
    nowSpy.mockReturnValue(300_000);
    act(() => {
      result.current.setWaitingResponse(true);
    });
    expect(result.current.turnStartedAtMs).toBe(300_000);
    nowSpy.mockRestore();
  });

  /**
   * Where the turn's token counts actually live on this backend.
   *
   * The report used to read them off the `finish` frame, which carries
   * `{"session_id": null}` and nothing else — so it never fired, on the
   * conversation type most members use. The counts arrive one frame earlier,
   * in `acp_context_usage._meta`.
   */
  describe('company spend reporting', () => {
    const usageFrame = (input: number, output: number) =>
      ({
        type: 'acp_context_usage',
        data: {
          used: 2366,
          size: 200_000,
          _meta: { input_tokens: input, output_tokens: output },
        },
        conversation_id: 'conv-1',
      }) as unknown as IResponseMessage;

    const finishFrame = () =>
      ({ type: 'finish', data: { session_id: null }, conversation_id: 'conv-1' }) as unknown as IResponseMessage;

    it('reports the counts the usage frame carried, once, at the turn boundary', async () => {
      vi.mocked(getConversationOrNull).mockResolvedValue(null);
      const { result } = renderHook(() => useDreamEngineMessage('conv-1'));
      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        responseStreamHandlerRef.current?.(usageFrame(11_118, 716));
      });
      // Nothing yet: the turn is still open, and a mid-turn report would bill
      // a turn that has not finished.
      expect(reportClientTurnUsageMock).not.toHaveBeenCalled();

      act(() => {
        responseStreamHandlerRef.current?.(finishFrame());
      });

      expect(reportClientTurnUsageMock).toHaveBeenCalledTimes(1);
      expect(reportClientTurnUsageMock).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        inputTokens: 11_118,
        outputTokens: 716,
      });
    });

    it('does not bill the same turn twice', async () => {
      vi.mocked(getConversationOrNull).mockResolvedValue(null);
      const { result } = renderHook(() => useDreamEngineMessage('conv-1'));
      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        responseStreamHandlerRef.current?.(usageFrame(10, 5));
        responseStreamHandlerRef.current?.(finishFrame());
        // A duplicated or late terminal frame must not produce a second row.
        responseStreamHandlerRef.current?.(finishFrame());
      });

      expect(reportClientTurnUsageMock).toHaveBeenCalledTimes(1);
    });

    it('reports nothing for a turn that produced no counts', async () => {
      vi.mocked(getConversationOrNull).mockResolvedValue(null);
      const { result } = renderHook(() => useDreamEngineMessage('conv-1'));
      await waitFor(() => {
        expect(result.current.hasHydratedRunningState).toBe(true);
      });

      act(() => {
        responseStreamHandlerRef.current?.(finishFrame());
      });

      expect(reportClientTurnUsageMock).not.toHaveBeenCalled();
    });
  });
});

describe('useDreamEngineMessage turn end', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationTurnClockForTests();
    conversationUpdateInvokeMock.mockResolvedValue(undefined);
    conversationGetUsageInvokeMock.mockResolvedValue(undefined);
    responseStreamHandlerRef.current = undefined;
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
  });

  const emit = (message: Partial<IResponseMessage>) => {
    act(() => {
      responseStreamHandlerRef.current?.({
        conversation_id: 'conv-1',
        msg_id: 'msg-1',
        ...message,
      } as IResponseMessage);
    });
  };

  const mountHook = async () => {
    const hook = renderHook(() => useDreamEngineMessage('conv-1'));
    await waitFor(() => {
      expect(hook.result.current.hasHydratedRunningState).toBe(true);
    });
    return hook;
  };

  /**
   * `running` is the OR of three flags. `finish` used to clear only two, so a
   * turn whose last seen tool_group still had a live tool kept the send box on
   * "processing" until the user switched conversations and back.
   */
  it('stops reporting a running turn when finish lands with a tool still marked active', async () => {
    const { result } = await mountHook();

    emit({ type: 'start' });
    emit({
      type: 'tool_group',
      data: [{ callId: 'c1', name: 'Write', status: 'Executing' }],
    });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });

    emit({ type: 'finish', data: {} });

    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });
  });

  /**
   * The auto-recover branches exist because this backend does emit frames after
   * `finish`. Re-arming on one is what left the spinner on forever: the turn is
   * over, so no second `finish` is coming to turn it off again.
   */
  it('does not let a frame trailing a finished turn re-arm the spinner', async () => {
    const { result } = await mountHook();

    emit({ type: 'start' });
    emit({ type: 'finish', data: {} });
    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });

    emit({ type: 'thought', data: { subject: 'late', description: 'trailing frame' } });
    emit({
      type: 'tool_group',
      data: [{ callId: 'c2', name: 'Read', status: 'Executing' }],
    });

    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });
  });

  /**
   * The guard is lowered by `start`, but a turn need not open with one. A frame
   * carrying a different turn_id than the finished turn belongs to a newer turn
   * and must still drive the indicator — the same rule the sidebar's late-frame
   * guard already uses.
   */
  it('lets a newer turn light the indicator even without a start frame', async () => {
    const { result } = await mountHook();

    emit({ type: 'start', turn_id: 'turn-1' });
    emit({ type: 'finish', data: {}, turn_id: 'turn-1' });
    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });

    // Newer turn, no `start` of its own.
    emit({
      type: 'tool_group',
      turn_id: 'turn-2',
      data: [{ callId: 'c3', name: 'Write', status: 'Executing' }],
    });

    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });
  });

  it('still treats a same-turn trailing frame as late', async () => {
    const { result } = await mountHook();

    emit({ type: 'start', turn_id: 'turn-1' });
    emit({ type: 'finish', data: {}, turn_id: 'turn-1' });
    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });

    emit({
      type: 'tool_group',
      turn_id: 'turn-1',
      data: [{ callId: 'c4', name: 'Write', status: 'Executing' }],
    });

    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });
  });

  it('still runs again for the next turn', async () => {
    const { result } = await mountHook();

    emit({ type: 'start' });
    emit({ type: 'finish', data: {} });
    await waitFor(() => {
      expect(result.current.running).toBe(false);
    });

    emit({ type: 'start' });
    await waitFor(() => {
      expect(result.current.running).toBe(true);
    });
  });
});
