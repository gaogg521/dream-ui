/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UIEvent } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { useAutoScroll } from '@/renderer/pages/conversation/Messages/useAutoScroll';

let resizeObserverCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }

  observe() {}
  unobserve() {}
  disconnect() {
    resizeObserverCallback = null;
  }
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

function createLeftMessage(content: string): TMessage {
  return {
    id: 'left-message',
    msg_id: 'left-message',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: {
      content,
    },
    created_at: 1,
  } as TMessage;
}

function createRightMessage(content: string): TMessage {
  return {
    id: 'right-message',
    msg_id: 'right-message',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'right',
    content: {
      content,
    },
    created_at: 1,
  } as TMessage;
}

function createScroller({
  scrollTop = 520,
  scrollHeight = 1000,
  clientHeight = 400,
}: {
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
} = {}): HTMLDivElement {
  const scroller = document.createElement('div');
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    writable: true,
    value: scrollTop,
  });
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    writable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    writable: true,
    value: clientHeight,
  });
  scroller.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    if (typeof top === 'number') {
      scroller.scrollTop = top;
    }
  });
  return scroller;
}

function createContent(): HTMLDivElement {
  return document.createElement('div');
}

function attachElements(
  result: ReturnType<typeof renderHook<typeof useAutoScroll>>['result'],
  scroller: HTMLDivElement,
  content: HTMLDivElement
): void {
  act(() => {
    result.current.handleScrollerRef(scroller);
    result.current.handleContentRef(content);
  });
}

function fireScroll(
  handleScroll: (event: UIEvent<HTMLDivElement>) => void,
  scroller: HTMLDivElement,
  nextScrollTop: number
): void {
  scroller.scrollTop = nextScrollTop;
  act(() => {
    handleScroll({
      currentTarget: scroller,
    } as UIEvent<HTMLDivElement>);
  });
}

describe('useAutoScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'));
    resizeObserverCallback = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('auto-follows to the bottom when content height changes and the user is still following output', () => {
    const scroller = createScroller();
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
  });

  it('keeps the visible message in place when a preview narrows the scroller', () => {
    const scroller = createScroller();
    const content = createContent();
    const row = document.createElement('div');
    content.append(row);
    let width = 800;
    let rowStart = 280;
    Object.defineProperty(scroller, 'clientWidth', { get: () => width });
    row.getBoundingClientRect = () => new DOMRect(0, rowStart - scroller.scrollTop, width, 100);
    const { result } = renderHook(() => useAutoScroll({ messages: [createLeftMessage('hello')], itemCount: 1 }));
    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
      result.current.handlePointerDown();
    });
    fireScroll(result.current.handleScroll, scroller, 300);
    expect(row.getBoundingClientRect().top).toBe(-20);

    width = 500;
    rowStart += 180;
    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });
    expect(scroller.scrollTop).toBe(480);
    expect(row.getBoundingClientRect().top).toBe(-20);
  });

  it('keeps the visible Markdown block when earlier paragraphs in the same message wrap', () => {
    const scroller = createScroller();
    const content = createContent();
    const row = document.createElement('div');
    const host = document.createElement('div');
    host.className = 'markdown-shadow';
    const body = document.createElement('div');
    body.className = 'markdown-shadow-body';
    const first = document.createElement('p');
    const second = document.createElement('p');
    body.append(first, second);
    host.attachShadow({ mode: 'open' }).append(body);
    row.append(host);
    content.append(row);
    scroller.append(content);
    const { container } = render(null);
    container.append(scroller);

    let width = 800;
    let firstHeight = 270;
    Object.defineProperty(scroller, 'clientWidth', { get: () => width });
    const rect = (top: number, height: number) => new DOMRect(0, top - scroller.scrollTop, width, height);
    row.getBoundingClientRect = body.getBoundingClientRect = () => rect(10, firstHeight + 200);
    first.getBoundingClientRect = () => rect(10, firstHeight);
    second.getBoundingClientRect = () => rect(10 + firstHeight, 200);

    const { result } = renderHook(() => useAutoScroll({ messages: [createLeftMessage('hello')], itemCount: 1 }));
    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
      result.current.handlePointerDown();
    });
    fireScroll(result.current.handleScroll, scroller, 300);
    expect(second.getBoundingClientRect().top).toBe(-20);

    width = 500;
    firstHeight += 180;
    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });
    expect(second.getBoundingClientRect().top).toBe(-20);
  });

  it('auto-follows assistant message updates even when resize observer does not fire', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [createLeftMessage('hello')] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    scroller.scrollHeight = 1080;
    act(() => {
      rerender({
        messages: [createLeftMessage('hello world'.repeat(8))],
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 680,
      behavior: 'auto',
    });
  });

  it('auto-follows newly appended assistant messages without forcing manual scroll state', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const nextAssistantMessage = {
      ...createLeftMessage('new assistant reply'),
      id: 'left-message-2',
      msg_id: 'left-message-2',
      created_at: 2,
    };
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [createLeftMessage('hello')] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    scroller.scrollHeight = 1080;
    act(() => {
      rerender({
        messages: [createLeftMessage('hello'), nextAssistantMessage],
      });
    });
    act(() => {
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 680,
      behavior: 'auto',
    });
  });

  it('does not auto-follow after the user scrolls up', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    fireScroll(result.current.handleScroll, scroller, 600);
    vi.setSystemTime(new Date('2026-05-26T12:00:00.250Z'));
    fireScroll(result.current.handleScroll, scroller, 480);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
    expect(result.current.showScrollButton).toBe(true);
  });

  it('does not auto-follow after the user manually scrolls while remaining away from the bottom', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    fireScroll(result.current.handleScroll, scroller, 240);
    vi.setSystemTime(new Date('2026-05-26T12:00:00.250Z'));
    fireScroll(result.current.handleScroll, scroller, 260);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
    expect(result.current.showScrollButton).toBe(true);
  });

  it('treats wheel-driven user scroll as manual intervention even inside the programmatic guard window', () => {
    const scroller = createScroller({ scrollTop: 600 });
    const content = createContent();
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );

    attachElements(result, scroller, content);
    act(() => {
      vi.runAllTimers();
    });
    vi.mocked(scroller.scrollTo).mockClear();

    act(() => {
      result.current.handleWheel({
        deltaX: 0,
        deltaY: -320,
      } as React.WheelEvent<HTMLDivElement>);
    });
    fireScroll(result.current.handleScroll, scroller, 260);

    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).not.toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
    expect(result.current.showScrollButton).toBe(true);
  });

  it('forces a bottom sync when a new user message is appended', () => {
    const scroller = createScroller();
    const content = createContent();
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useAutoScroll({
          messages,
          itemCount: messages.length,
        }),
      {
        initialProps: {
          messages: [createLeftMessage('hello')] as TMessage[],
        },
      }
    );

    attachElements(result, scroller, content);

    act(() => {
      rerender({
        messages: [createLeftMessage('hello'), createRightMessage('question')],
      });
      vi.runAllTimers();
    });

    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: 'auto',
    });
  });

  it('scrolls a target element into view for explicit message jumps', () => {
    const { result } = renderHook(() =>
      useAutoScroll({
        messages: [createLeftMessage('hello')],
        itemCount: 1,
      })
    );
    const target = document.createElement('div');
    target.scrollIntoView = vi.fn();

    act(() => {
      result.current.scrollElementIntoView(target, {
        behavior: 'smooth',
        block: 'center',
      });
    });

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  });
});
