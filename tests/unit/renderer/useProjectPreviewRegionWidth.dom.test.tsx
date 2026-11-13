/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useProjectPreviewRegionWidth } from '@/renderer/hooks/ui/useProjectPreviewRegionWidth';

const MIN_CHAT = 360;
const MIN_PREVIEW = 340;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('chat-preview-width-px', '480'); // requested width
});

describe('useProjectPreviewRegionWidth (P4 ordered clamp)', () => {
  it('uses the requested width when there is ample room', () => {
    // available 2000, explorer 300 → max = 2000-360-300 = 1340 → min(480,1340)=480
    const { result } = renderHook(() => useProjectPreviewRegionWidth(2000, 300, true));
    expect(result.current.widthPx).toBe(480);
  });

  it('clamps so chat keeps MIN_CHAT after the explorer + preview chrome', () => {
    // available 1256, explorer 501, preview chrome 24 (ml-8+mr-12+border+buffer)
    // → max = 1256-360-501-24 = 371 → min(480,371)=371
    // ⇒ occupied preview+chrome = 371+24 = 395; content = 1256-501-395 = 360 = MIN_CHAT
    const CHROME = 24;
    const { result } = renderHook(() => useProjectPreviewRegionWidth(1256, 501, true));
    expect(result.current.widthPx).toBe(371);
    expect(1256 - 501 - result.current.widthPx - CHROME).toBe(MIN_CHAT);
  });

  it('gets more room when the explorer is collapsed (width 0)', () => {
    // available 1256, explorer 0 → max = 896 → min(480,896)=480
    const { result } = renderHook(() => useProjectPreviewRegionWidth(1256, 0, true));
    expect(result.current.widthPx).toBe(480);
  });

  it('never drops below MIN_PREVIEW even when the row is very tight', () => {
    // available 900, explorer 400 → max = max(340, 900-360-400=140) = 340 (floor)
    const { result } = renderHook(() => useProjectPreviewRegionWidth(900, 400, true));
    expect(result.current.widthPx).toBe(MIN_PREVIEW);
  });
});

describe('useProjectPreviewRegionWidth browser fit', () => {
  // Mirrors Layout: the column's collapsed state and the width live in the same
  // component, so a fold and a widen from one effect land in a single render.
  const setup = (availableWidth: number, explorerWidth: number, startCollapsed = false) => {
    const foldCalls: boolean[] = [];
    const hook = renderHook(
      (props: { shown: boolean }) => {
        const [collapsed, setCollapsedState] = useState(startCollapsed);
        const setCollapsed = (next: boolean) => {
          foldCalls.push(next);
          setCollapsedState(next);
        };
        const region = useProjectPreviewRegionWidth(availableWidth, collapsed ? 0 : explorerWidth, true, {
          shown: props.shown,
          explorerCollapsed: collapsed,
          setExplorerCollapsed: setCollapsed,
        });
        return { ...region, collapsed, userSetCollapsed: setCollapsedState };
      },
      { initialProps: { shown: false } }
    );
    return { hook, foldCalls };
  };

  it('folds the explorer and widens the preview on a narrow window (the reported case)', () => {
    // 1050px row, explorer 232: keeping it would leave 1050-360-24-232 = 434 < 640
    const { hook, foldCalls } = setup(1050, 232);
    const savedBefore = localStorage.getItem('chat-preview-width-px'); // ordinary clamp at mount
    hook.rerender({ shown: true });
    expect(foldCalls).toEqual([true]);
    expect(hook.result.current.collapsed).toBe(true);
    expect(hook.result.current.widthPx).toBe(640);
    // transient: neither the widening nor the interim clamp may be saved
    expect(localStorage.getItem('chat-preview-width-px')).toBe(savedBefore);
  });

  it('keeps the explorer on a wide window and only widens the preview', () => {
    const { hook, foldCalls } = setup(1800, 260);
    hook.rerender({ shown: true });
    expect(foldCalls).toEqual([]);
    expect(hook.result.current.collapsed).toBe(false);
    expect(hook.result.current.widthPx).toBe(640);
  });

  it('hands the explorer and the width back when the browser goes away', () => {
    const { hook, foldCalls } = setup(1050, 232);
    hook.rerender({ shown: true });
    hook.rerender({ shown: false });
    expect(foldCalls).toEqual([true, false]);
    expect(hook.result.current.collapsed).toBe(false);
    // back to the saved 480, then clamped by the ordinary rule: 1050-360-232-24 = 434
    expect(hook.result.current.widthPx).toBe(434);
  });

  it('does not unfold a column the user opened by hand while the browser was up', () => {
    const { hook, foldCalls } = setup(1050, 232);
    hook.rerender({ shown: true });
    act(() => hook.result.current.userSetCollapsed(false)); // user unfolds
    foldCalls.length = 0;
    hook.rerender({ shown: false });
    expect(foldCalls).toEqual([]);
    expect(hook.result.current.collapsed).toBe(false);
  });

  it('leaves a column the user had folded alone', () => {
    const { hook, foldCalls } = setup(1050, 232, true);
    hook.rerender({ shown: true });
    expect(hook.result.current.widthPx).toBe(640);
    hook.rerender({ shown: false });
    expect(foldCalls).toEqual([]);
    expect(hook.result.current.collapsed).toBe(true);
  });
});
