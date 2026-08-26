/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The store exists so the conversation header can stop naming the chat model
 * while the send box is in a generation mode — two indicators disagreeing about
 * "the model" leaves the user unable to tell what the next Enter will run.
 *
 * Driven through the hook, because the subscription is the contract: a setter
 * that mutates without notifying would leave the header stale and no direct
 * read of the map would catch it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  clearMediaModeSnapshot,
  consumeMediaModeRequest,
  requestMediaMode,
  setMediaModeSnapshot,
  useMediaModeRequest,
  useMediaModeSnapshot,
} from '@/renderer/hooks/media/mediaModeStore';

afterEach(() => {
  cleanup();
  clearMediaModeSnapshot('c1');
  clearMediaModeSnapshot('c2');
});

describe('mediaModeStore', () => {
  it('starts off and reports the mode the send box entered', () => {
    const { result } = renderHook(() => useMediaModeSnapshot('c1'));
    expect(result.current).toEqual({ mode: 'off' });

    act(() => setMediaModeSnapshot('c1', { mode: 'image', model: 'gpt-image-2' }));
    expect(result.current).toEqual({ mode: 'image', model: 'gpt-image-2' });
  });

  // Each conversation has its own send box; one entering image mode must not
  // relabel another conversation's header.
  it('scopes the mode to one conversation', () => {
    const first = renderHook(() => useMediaModeSnapshot('c1'));
    const second = renderHook(() => useMediaModeSnapshot('c2'));

    act(() => setMediaModeSnapshot('c1', { mode: 'video', model: 'seedance-2-0-pro' }));

    expect(first.result.current.mode).toBe('video');
    expect(second.result.current.mode).toBe('off');
  });

  it('goes back to off when the user leaves media mode', () => {
    const { result } = renderHook(() => useMediaModeSnapshot('c1'));
    act(() => setMediaModeSnapshot('c1', { mode: 'image', model: 'gpt-image-2' }));
    act(() => setMediaModeSnapshot('c1', { mode: 'off' }));
    expect(result.current).toEqual({ mode: 'off' });
  });

  // Unmounting a conversation must not leave its header claiming a mode that
  // no send box is in any more.
  it('clears on unmount, idempotently', () => {
    const { result } = renderHook(() => useMediaModeSnapshot('c2'));
    act(() => setMediaModeSnapshot('c2', { mode: 'video', model: 'seedance' }));
    expect(result.current.mode).toBe('video');

    act(() => {
      clearMediaModeSnapshot('c2');
      clearMediaModeSnapshot('c2');
    });
    expect(result.current).toEqual({ mode: 'off' });
  });

  it('ignores a write with no conversation id rather than leaking a global mode', () => {
    const { result } = renderHook(() => useMediaModeSnapshot(undefined));
    act(() => setMediaModeSnapshot(undefined, { mode: 'video', model: 'seedance' }));
    expect(result.current).toEqual({ mode: 'off' });
  });
});

/**
 * The other direction: the model picker (in the conversation header) asking the
 * send box to enter a generation mode. Media models had been absent from that
 * picker entirely, so declaring one as a video model made it vanish from the
 * conversation — the declaration looked like it had done nothing.
 */
describe('requestMediaMode', () => {
  it('carries the mode and the exact provider+model to apply', () => {
    const { result } = renderHook(() => useMediaModeRequest('c-req'));
    act(() => requestMediaMode('c-req', 'video', { providerId: 'p-1', model: 'seedance-2-0-fast' }));
    expect(result.current).toMatchObject({ mode: 'video', providerId: 'p-1', model: 'seedance-2-0-fast' });
  });

  /**
   * `seq` is what lets a consumer apply a request exactly once. Without it a
   * re-render after the user manually switched back would re-apply the old
   * request and fight them for control of the send box.
   */
  it('gives every request a new seq, including an identical repeat', () => {
    const { result } = renderHook(() => useMediaModeRequest('c-seq'));
    act(() => requestMediaMode('c-seq', 'image', { providerId: 'p', model: 'm' }));
    const first = result.current?.seq;
    act(() => requestMediaMode('c-seq', 'image', { providerId: 'p', model: 'm' }));
    expect(result.current?.seq).toBeGreaterThan(first as number);
  });

  it('can ask to leave a mode, which needs no model', () => {
    const { result } = renderHook(() => useMediaModeRequest('c-off'));
    act(() => requestMediaMode('c-off', 'off'));
    expect(result.current).toMatchObject({ mode: 'off' });
    expect(result.current?.model).toBeUndefined();
  });

  it('keeps conversations apart', () => {
    const { result } = renderHook(() => useMediaModeRequest('c-a'));
    act(() => requestMediaMode('c-b', 'video', { providerId: 'p', model: 'm' }));
    expect(result.current).toBeUndefined();
  });

  it('ignores a request with no conversation', () => {
    const { result } = renderHook(() => useMediaModeRequest(undefined));
    act(() => requestMediaMode(undefined, 'image', { providerId: 'p', model: 'm' }));
    expect(result.current).toBeUndefined();
  });
});

/**
 * A request is a one-shot instruction and has to stop existing once applied.
 *
 * `seq` alone does not achieve that: the composer remembers the last applied
 * seq in a ref, and a ref dies with the component. An applied request left in
 * the store was therefore re-applied whenever the send box remounted — the user
 * left video mode, switched conversations and came back, and the send box
 * yanked them into video mode again.
 */
describe('consumeMediaModeRequest', () => {
  it('drops the request it is given, so a fresh reader sees nothing', () => {
    const { result } = renderHook(() => useMediaModeRequest('c-consume'));
    act(() => requestMediaMode('c-consume', 'video', { providerId: 'p', model: 'm' }));
    const seq = result.current?.seq as number;

    act(() => consumeMediaModeRequest('c-consume', seq));
    expect(result.current).toBeUndefined();
  });

  /**
   * The regression this was written for. A remount is modelled the way it
   * actually happens: the component goes away and a brand-new one subscribes.
   * Before the fix the second mount read the already-applied request back.
   */
  it('leaves nothing for a remounted send box to re-apply', () => {
    const first = renderHook(() => useMediaModeRequest('c-remount'));
    act(() => requestMediaMode('c-remount', 'video', { providerId: 'p', model: 'seedance' }));
    const seq = first.result.current?.seq as number;
    expect(seq).toBeGreaterThan(0);

    // The composer applies it, then consumes it.
    act(() => consumeMediaModeRequest('c-remount', seq));
    first.unmount();

    const remounted = renderHook(() => useMediaModeRequest('c-remount'));
    expect(remounted.result.current).toBeUndefined();
  });

  /**
   * Consuming is keyed on the exact seq so a request that lands between the
   * effect running and the consume call is not thrown away unapplied — that
   * would silently swallow the user's most recent pick.
   */
  it('does not discard a newer request that arrived after the one applied', () => {
    const { result } = renderHook(() => useMediaModeRequest('c-race'));
    act(() => requestMediaMode('c-race', 'image', { providerId: 'p', model: 'first' }));
    const applied = result.current?.seq as number;

    act(() => requestMediaMode('c-race', 'video', { providerId: 'p', model: 'second' }));
    act(() => consumeMediaModeRequest('c-race', applied));

    expect(result.current).toMatchObject({ mode: 'video', model: 'second' });
  });

  it('ignores an unknown conversation and a missing id', () => {
    expect(() => consumeMediaModeRequest('c-never-requested', 1)).not.toThrow();
    expect(() => consumeMediaModeRequest(undefined, 1)).not.toThrow();
  });
});
