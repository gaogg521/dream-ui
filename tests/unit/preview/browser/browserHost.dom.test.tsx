/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 全局浏览器宿主：webview 不依赖预览面板是否打开，且贴在面板的占位元素上。
 * Global browser host: webviews must not depend on the preview panel being open, and must
 * sit over the panel's placeholder element.
 */

import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  value: {
    tabs: [{ id: 'browser-1', content_type: 'browser' }] as Array<{ id: string; content_type: string }>,
    activeTabId: null as string | null,
    updateTab: vi.fn(),
    browserSlot: null as HTMLElement | null,
  },
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => state.value,
}));
vi.mock('@/renderer/pages/conversation/Preview/browser/BrowserTabLayer', () => ({
  default: ({ panelVisible }: { panelVisible?: boolean }) => <div data-testid='layer' data-visible={panelVisible} />,
}));

import BrowserHost from '@/renderer/pages/conversation/Preview/browser/BrowserHost';

const host = () => document.querySelector<HTMLElement>('[data-testid="browser-host"]');

const slots: HTMLElement[] = [];

const makeSlot = (rect: { left: number; top: number; width: number; height: number }) => {
  const slot = document.createElement('div');
  document.body.appendChild(slot);
  slots.push(slot);
  slot.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }) as DOMRect;
  return slot;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  state.value = { ...state.value, tabs: [{ id: 'browser-1', content_type: 'browser' }], browserSlot: null };
});

afterEach(() => {
  vi.useRealTimers();
  slots.splice(0).forEach((slot) => slot.remove());
});

describe('BrowserHost', () => {
  it('renders nothing when there are no browser tabs', () => {
    state.value = { ...state.value, tabs: [{ id: 'f', content_type: 'markdown' }] };
    render(<BrowserHost />);
    expect(host()).toBeNull();
  });

  it('keeps the webviews mounted but parked off-screen while the panel is closed', () => {
    render(<BrowserHost />);
    const el = host();
    expect(el).not.toBeNull();
    expect(el?.style.left).toBe('-20000px');
    expect(el?.style.pointerEvents).toBe('none');
    expect(el?.querySelector('[data-testid="layer"]')?.getAttribute('data-visible')).toBe('false');
  });

  it('sits over the panel placeholder and follows it when it moves', () => {
    const slot = makeSlot({ left: 300, top: 80, width: 600, height: 400 });
    state.value = { ...state.value, browserSlot: slot };
    render(<BrowserHost />);

    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(host()?.style.left).toBe('300px');
    expect(host()?.style.top).toBe('80px');
    expect(host()?.style.width).toBe('600px');
    expect(host()?.style.height).toBe('400px');
    expect(host()?.style.pointerEvents).toBe('');

    // 拖拽分栏：只有位置变、尺寸不变，也必须跟上
    // Split dragging: position changes while size stays — still has to follow.
    slot.getBoundingClientRect = () => ({ left: 120, top: 80, width: 600, height: 400 }) as DOMRect;
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(host()?.style.left).toBe('120px');
  });

  it('parks again when the placeholder collapses to zero (a document tab is active)', () => {
    const slot = makeSlot({ left: 300, top: 80, width: 600, height: 400 });
    state.value = { ...state.value, browserSlot: slot };
    render(<BrowserHost />);
    act(() => {
      vi.advanceTimersByTime(40);
    });

    slot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(host()?.style.left).toBe('-20000px');
    expect(host()?.style.pointerEvents).toBe('none');
  });
});
