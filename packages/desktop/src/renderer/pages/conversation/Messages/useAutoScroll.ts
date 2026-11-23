/**
 * Copyright 2026 One Work
 */

/**
 * useAutoScroll - Auto-scroll hook for a plain scroll container
 *
 * Strategy:
 * - Track whether the user has intentionally scrolled away from the bottom.
 * - Observe content/scroller size changes and keep the list pinned to bottom
 *   only while auto-follow mode is active.
 * - Use DOM-native scrollIntoView for explicit message jumps.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TMessage } from '@/common/chat/chatLib';

const PROGRAMMATIC_SCROLL_GUARD_MS = 150;
const AT_BOTTOM_THRESHOLD_PX = 100;
const FOLLOW_BOTTOM_THRESHOLD_PX = 4;

interface UseAutoScrollOptions {
  messages: TMessage[];
  itemCount: number;
}

interface ScrollElementIntoViewOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
}

interface UseAutoScrollReturn {
  handleScrollerRef: (ref: HTMLDivElement | null) => void;
  handleContentRef: (ref: HTMLDivElement | null) => void;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  handleWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  handlePointerDown: () => void;
  showScrollButton: boolean;
  hasScrollOverflow: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollElementIntoView: (element: HTMLElement | null, options?: ScrollElementIntoViewOptions) => void;
  hideScrollButton: () => void;
}

const getBottomGap = (element: HTMLElement): number => {
  return element.scrollHeight - element.clientHeight - element.scrollTop;
};

// Message rows are in visual order. Find the first one intersecting the top
// of the viewport without measuring the entire conversation on every scroll.
const findReadingRow = (rows: HTMLCollection, viewportTop: number): Element | undefined => {
  let start = 0;
  let end = rows.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (rows[middle].getBoundingClientRect().bottom <= viewportTop) {
      start = middle + 1;
    } else {
      end = middle;
    }
  }
  return rows[start];
};

export function useAutoScroll({ messages, itemCount }: UseAutoScrollOptions): UseAutoScrollReturn {
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasScrollOverflow, setHasScrollOverflow] = useState(false);

  const userScrolledRef = useRef(false);
  const viewportWidthRef = useRef(0);
  const readingAnchorRef = useRef<{ row: Element; target: Element; offset: number } | null>(null);
  const lastScrollTopRef = useRef(0);
  const previousListLengthRef = useRef(messages.length);
  const previousLastMessageRef = useRef<TMessage | undefined>(messages[messages.length - 1]);
  const lastProgrammaticScrollTimeRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const pendingAutoFollowFrameRef = useRef<number | null>(null);
  const userInputActiveRef = useRef(false);

  const markProgrammaticScroll = useCallback(() => {
    lastProgrammaticScrollTimeRef.current = Date.now();
  }, []);

  const updateBottomState = useCallback((element: HTMLDivElement) => {
    setHasScrollOverflow(element.scrollHeight > element.clientHeight + 1);
    const bottomGap = getBottomGap(element);
    const withinButtonThreshold = bottomGap <= AT_BOTTOM_THRESHOLD_PX;
    const pinnedToBottom = bottomGap <= FOLLOW_BOTTOM_THRESHOLD_PX;
    setShowScrollButton(!withinButtonThreshold);

    if (pinnedToBottom) {
      userScrolledRef.current = false;
      userInputActiveRef.current = false;
      lastProgrammaticScrollTimeRef.current = Date.now() - (PROGRAMMATIC_SCROLL_GUARD_MS - 50);
    }

    return pinnedToBottom;
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (itemCount <= 0 || !scrollerEl) return;

      markProgrammaticScroll();
      scrollerEl.scrollTo({
        top: scrollerEl.scrollHeight - scrollerEl.clientHeight,
        behavior,
      });
      userScrolledRef.current = false;
      readingAnchorRef.current = null;
      setShowScrollButton(false);
    },
    [itemCount, markProgrammaticScroll, scrollerEl]
  );

  const scheduleAutoFollow = useCallback(() => {
    if (!scrollerEl || userScrolledRef.current) return;

    if (pendingAutoFollowFrameRef.current !== null) {
      cancelAnimationFrame(pendingAutoFollowFrameRef.current);
    }

    pendingAutoFollowFrameRef.current = requestAnimationFrame(() => {
      pendingAutoFollowFrameRef.current = null;
      if (!scrollerEl || userScrolledRef.current) return;

      const gap = getBottomGap(scrollerEl);
      if (gap > 2) {
        scrollToBottom('auto');
      }
    });
  }, [scrollerEl, scrollToBottom]);

  const handleScrollerRef = useCallback((ref: HTMLDivElement | null) => {
    viewportWidthRef.current = ref?.clientWidth ?? 0;
    readingAnchorRef.current = null;
    setScrollerEl(ref);
  }, []);

  const handleContentRef = useCallback((ref: HTMLDivElement | null) => {
    setContentEl(ref);
  }, []);

  const scrollElementIntoView = useCallback(
    (element: HTMLElement | null, options?: ScrollElementIntoViewOptions) => {
      if (!element) return;

      userScrolledRef.current = false;
      readingAnchorRef.current = null;
      setShowScrollButton(false);
      markProgrammaticScroll();
      element.scrollIntoView({
        behavior: options?.behavior ?? 'smooth',
        block: options?.block ?? 'start',
        inline: 'nearest',
      });
    },
    [markProgrammaticScroll]
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      // Resize can emit a scroll event before the observer restores the anchor.
      if (target.clientWidth !== viewportWidthRef.current) return;
      const currentScrollTop = target.scrollTop;
      const timeSinceGuard = Date.now() - lastProgrammaticScrollTimeRef.current;
      const delta = currentScrollTop - lastScrollTopRef.current;
      const bottomGap = getBottomGap(target);
      const pinnedToBottom = bottomGap <= FOLLOW_BOTTOM_THRESHOLD_PX;

      if (
        !pinnedToBottom &&
        Math.abs(delta) > 2 &&
        (userInputActiveRef.current || timeSinceGuard >= PROGRAMMATIC_SCROLL_GUARD_MS)
      ) {
        userScrolledRef.current = true;
      }

      if (pinnedToBottom) {
        userInputActiveRef.current = false;
      } else if (Math.abs(delta) > 2) {
        userInputActiveRef.current = false;
      }

      lastScrollTopRef.current = currentScrollTop;
      if (userScrolledRef.current && !pinnedToBottom && contentEl) {
        const viewportTop = target.getBoundingClientRect().top;
        const row = findReadingRow(contentEl.children, viewportTop);
        readingAnchorRef.current = null;
        if (row) {
          // A long Markdown reply can reflow inside the same row. Anchor the
          // visible block when the viewport starts inside that reply.
          const body = row.querySelector('.markdown-shadow')?.shadowRoot?.querySelector('.markdown-shadow-body');
          const bodyRect = body?.getBoundingClientRect();
          const block =
            body && bodyRect && bodyRect.top <= viewportTop && bodyRect.bottom > viewportTop
              ? findReadingRow(body.children, viewportTop)
              : undefined;
          const target = block ?? row;
          readingAnchorRef.current = { row, target, offset: target.getBoundingClientRect().top - viewportTop };
        }
      } else {
        readingAnchorRef.current = null;
      }
      updateBottomState(target);
    },
    [contentEl, updateBottomState]
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > 0 || Math.abs(e.deltaX) > 0) {
      userInputActiveRef.current = true;
    }
  }, []);

  const handlePointerDown = useCallback(() => {
    userInputActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (!scrollerEl || !contentEl) return;

    const observer = new ResizeObserver(() => {
      const width = scrollerEl.clientWidth;
      const anchor = readingAnchorRef.current;
      if (
        width !== viewportWidthRef.current &&
        anchor &&
        contentEl.contains(anchor.row) &&
        (anchor.target === anchor.row || anchor.target.isConnected)
      ) {
        const viewportTop = scrollerEl.getBoundingClientRect().top;
        markProgrammaticScroll();
        const targetRect = anchor.target.getBoundingClientRect();
        const offset = Math.max(anchor.offset, 1 - targetRect.height);
        scrollerEl.scrollTop += targetRect.top - viewportTop - offset;
        readingAnchorRef.current = { ...anchor, offset };
        lastScrollTopRef.current = scrollerEl.scrollTop;
      }
      viewportWidthRef.current = width;
      scheduleAutoFollow();
      updateBottomState(scrollerEl);
    });

    observer.observe(scrollerEl);
    observer.observe(contentEl);

    return () => observer.disconnect();
  }, [contentEl, markProgrammaticScroll, scheduleAutoFollow, scrollerEl, updateBottomState]);

  useEffect(() => {
    if (!scrollerEl || initialScrollDoneRef.current || itemCount === 0) return;

    initialScrollDoneRef.current = true;
    requestAnimationFrame(() => {
      scrollToBottom('auto');
      lastScrollTopRef.current = scrollerEl.scrollTop;
    });
  }, [itemCount, scrollerEl, scrollToBottom]);

  useEffect(() => {
    const currentListLength = messages.length;
    const previousLength = previousListLengthRef.current;
    const lastMessage = messages[messages.length - 1];
    const previousLastMessage = previousLastMessageRef.current;
    const isNewMessage = currentListLength > previousLength;
    const isLastMessageUpdated = currentListLength > 0 && lastMessage !== previousLastMessage;

    previousListLengthRef.current = currentListLength;
    previousLastMessageRef.current = lastMessage;

    if (!isNewMessage) {
      if (isLastMessageUpdated) {
        scheduleAutoFollow();
      }
      return;
    }

    if (lastMessage?.position !== 'right') {
      scheduleAutoFollow();
      return;
    }

    userScrolledRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom('auto');
      });
    });
  }, [messages, scheduleAutoFollow, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (pendingAutoFollowFrameRef.current !== null) {
        cancelAnimationFrame(pendingAutoFollowFrameRef.current);
      }
    };
  }, []);

  const hideScrollButton = useCallback(() => {
    userScrolledRef.current = false;
    setShowScrollButton(false);
  }, []);

  return {
    handleScrollerRef,
    handleContentRef,
    handleScroll,
    handleWheel,
    handlePointerDown,
    showScrollButton,
    hasScrollOverflow,
    scrollToBottom,
    scrollElementIntoView,
    hideScrollButton,
  };
}
