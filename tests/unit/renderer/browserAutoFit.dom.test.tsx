/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 浏览器面板出现时自动让位：先压缩聊天区，不够再收起右侧工作区栏；浏览器消失后归位。
 * Making room for the browser panel: shrink chat first, fold the workspace sider only
 * when that is not enough, and give both back when the browser goes away.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBrowserAutoFit } from '@/renderer/pages/conversation/hooks/useBrowserAutoFit';
import {
  BROWSER_PREFERRED_PANEL_PX,
  MIN_CHAT_PANEL_PX,
  planBrowserFit,
} from '@/renderer/pages/conversation/utils/layoutCalc';

describe('planBrowserFit', () => {
  it('folds the workspace and shrinks chat on a typical 1050px window (the reported case)', () => {
    const plan = planBrowserFit({
      containerWidth: 1050,
      workspaceWidthPx: 260,
      workspaceVisible: true,
      chatSplitRatio: 60,
    });
    expect(plan.collapseWorkspace).toBe(true);
    // preview must end up at least BROWSER_PREFERRED_PANEL_PX wide
    const chatPx = (1050 * (plan.chatRatio as number)) / 100;
    expect(1050 - chatPx).toBeGreaterThanOrEqual(BROWSER_PREFERRED_PANEL_PX - 1);
    expect(chatPx).toBeGreaterThanOrEqual(MIN_CHAT_PANEL_PX - 1);
  });

  it('keeps the workspace on a wide window and only shrinks chat', () => {
    const plan = planBrowserFit({
      containerWidth: 1800,
      workspaceWidthPx: 260,
      workspaceVisible: true,
      chatSplitRatio: 60,
    });
    expect(plan.collapseWorkspace).toBe(false);
    const available = 1800 - 260;
    const previewPx = (available * (100 - (plan.chatRatio as number))) / 100;
    expect(previewPx).toBeGreaterThanOrEqual(BROWSER_PREFERRED_PANEL_PX - 1);
  });

  it('leaves everything alone when the preview is already wide enough', () => {
    const plan = planBrowserFit({
      containerWidth: 2400,
      workspaceWidthPx: 260,
      workspaceVisible: true,
      chatSplitRatio: 40,
    });
    expect(plan).toEqual({ collapseWorkspace: false, chatRatio: null });
  });

  it('never grows the chat area', () => {
    const plan = planBrowserFit({
      containerWidth: 1500,
      workspaceWidthPx: 0,
      workspaceVisible: false,
      chatSplitRatio: 30,
    });
    expect(plan.chatRatio === null || plan.chatRatio <= 30).toBe(true);
  });
});

describe('useBrowserAutoFit', () => {
  const setup = (overrides: Partial<Parameters<typeof useBrowserAutoFit>[0]> = {}) => {
    const setRightSiderCollapsed = vi.fn();
    const setChatSplitRatioTransient = vi.fn();
    const base = {
      browserShown: false,
      containerWidth: 1050,
      workspaceEnabled: true,
      rightSiderCollapsed: false,
      setRightSiderCollapsed,
      workspaceWidthPx: 260,
      chatSplitRatio: 60,
      setChatSplitRatioTransient,
      ...overrides,
    };
    const hook = renderHook((props: typeof base) => useBrowserAutoFit(props), { initialProps: base });
    return { hook, base, setRightSiderCollapsed, setChatSplitRatioTransient };
  };

  it('does nothing while no browser is shown', () => {
    const { setRightSiderCollapsed, setChatSplitRatioTransient } = setup();
    expect(setRightSiderCollapsed).not.toHaveBeenCalled();
    expect(setChatSplitRatioTransient).not.toHaveBeenCalled();
  });

  it('folds the sider and shrinks chat when the browser appears, then restores both', () => {
    const { hook, base, setRightSiderCollapsed, setChatSplitRatioTransient } = setup();

    hook.rerender({ ...base, browserShown: true });
    expect(setRightSiderCollapsed).toHaveBeenCalledWith(true);
    expect(setChatSplitRatioTransient).toHaveBeenCalledTimes(1);
    const applied = setChatSplitRatioTransient.mock.calls[0][0] as number;
    expect(applied).toBeLessThan(60);

    // The parent applies the new state; the browser is then closed.
    setRightSiderCollapsed.mockClear();
    setChatSplitRatioTransient.mockClear();
    hook.rerender({ ...base, browserShown: true, rightSiderCollapsed: true, chatSplitRatio: applied });
    hook.rerender({ ...base, browserShown: false, rightSiderCollapsed: true, chatSplitRatio: applied });
    expect(setRightSiderCollapsed).toHaveBeenCalledWith(false);
    expect(setChatSplitRatioTransient).toHaveBeenCalledWith(60);
  });

  it('does not re-expand a sider the user opened again by hand', () => {
    const { hook, base, setRightSiderCollapsed, setChatSplitRatioTransient } = setup();
    hook.rerender({ ...base, browserShown: true });
    const applied = setChatSplitRatioTransient.mock.calls[0][0] as number;

    hook.rerender({ ...base, browserShown: true, rightSiderCollapsed: true, chatSplitRatio: applied });
    // user expands the workspace manually while the browser is still up
    hook.rerender({ ...base, browserShown: true, rightSiderCollapsed: false, chatSplitRatio: applied });
    setRightSiderCollapsed.mockClear();
    hook.rerender({ ...base, browserShown: false, rightSiderCollapsed: false, chatSplitRatio: applied });
    expect(setRightSiderCollapsed).not.toHaveBeenCalled();
  });

  it('keeps the ratio the user dragged to instead of restoring the old one', () => {
    const { hook, base, setChatSplitRatioTransient } = setup();
    hook.rerender({ ...base, browserShown: true });
    const applied = setChatSplitRatioTransient.mock.calls[0][0] as number;
    setChatSplitRatioTransient.mockClear();

    // user drags the divider to somewhere else
    hook.rerender({ ...base, browserShown: true, rightSiderCollapsed: true, chatSplitRatio: applied + 12 });
    hook.rerender({ ...base, browserShown: false, rightSiderCollapsed: true, chatSplitRatio: applied + 12 });
    expect(setChatSplitRatioTransient).not.toHaveBeenCalled();
  });

  it('waits for a measured container before fitting', () => {
    const { hook, base, setRightSiderCollapsed } = setup({ containerWidth: 0 });
    hook.rerender({ ...base, browserShown: true, containerWidth: 0 });
    expect(setRightSiderCollapsed).not.toHaveBeenCalled();
    hook.rerender({ ...base, browserShown: true, containerWidth: 1050 });
    expect(setRightSiderCollapsed).toHaveBeenCalledWith(true);
  });
});
