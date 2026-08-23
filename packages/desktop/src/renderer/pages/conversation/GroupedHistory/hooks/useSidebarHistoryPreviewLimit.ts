/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** ConversationRow is h-34px with ~2px gap between siblings. */
export const SIDEBAR_HISTORY_ROW_HEIGHT_PX = 36;
export const SIDEBAR_HISTORY_PREVIEW_MIN = 3;
export const SIDEBAR_HISTORY_PREVIEW_MAX = 40;
/**
 * Load this many times what visually fits, so the scroll area (already
 * `overflow-y-auto`) has extra rows to reveal on scroll instead of clipping
 * exactly at the fold — the user can see more history in place, without
 * jumping to Session Center for anything beyond the first screenful.
 */
const SIDEBAR_HISTORY_LOAD_MULTIPLIER = 2;

function clampPreviewLimit(rows: number): number {
  return Math.min(SIDEBAR_HISTORY_PREVIEW_MAX, Math.max(SIDEBAR_HISTORY_PREVIEW_MIN, rows));
}

/**
 * Measure how many recent history rows fit in the sidebar scroll area after
 * pinned + project blocks, so tall screens load more and laptops load fewer —
 * then load `SIDEBAR_HISTORY_LOAD_MULTIPLIER` times that so the area can be
 * scrolled to reveal more without leaving the sidebar (see multiplier above).
 *
 * `layoutKey` should change when pinned/projects visibility or collapse state
 * changes so observers re-attach to newly mounted blocks.
 */
export function useSidebarHistoryPreviewLimit(
  enabled: boolean,
  layoutKey: string | number
): {
  previewLimit: number;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  pinnedBlockRef: RefObject<HTMLDivElement | null>;
  projectsBlockRef: RefObject<HTMLDivElement | null>;
} {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const pinnedBlockRef = useRef<HTMLDivElement | null>(null);
  const projectsBlockRef = useRef<HTMLDivElement | null>(null);
  const [previewLimit, setPreviewLimit] = useState(SIDEBAR_HISTORY_PREVIEW_MIN);

  const recalculate = useCallback(() => {
    if (!enabled) {
      setPreviewLimit(SIDEBAR_HISTORY_PREVIEW_MIN);
      return;
    }
    const scrollEl = scrollAreaRef.current;
    if (!scrollEl) {
      setPreviewLimit(SIDEBAR_HISTORY_PREVIEW_MIN);
      return;
    }

    const scrollHeight = scrollEl.clientHeight;
    const pinnedHeight = pinnedBlockRef.current?.offsetHeight ?? 0;
    const projectsHeight = projectsBlockRef.current?.offsetHeight ?? 0;
    const available = Math.max(0, scrollHeight - pinnedHeight - projectsHeight);
    const fittingRows = Math.floor(available / SIDEBAR_HISTORY_ROW_HEIGHT_PX);
    const rows =
      (Number.isFinite(fittingRows) ? fittingRows : SIDEBAR_HISTORY_PREVIEW_MIN) * SIDEBAR_HISTORY_LOAD_MULTIPLIER;
    setPreviewLimit(clampPreviewLimit(rows));
  }, [enabled]);

  useLayoutEffect(() => {
    if (!enabled) {
      setPreviewLimit(SIDEBAR_HISTORY_PREVIEW_MIN);
      return;
    }

    recalculate();

    const observed: Element[] = [];
    const scrollEl = scrollAreaRef.current;
    if (scrollEl) observed.push(scrollEl);
    if (pinnedBlockRef.current) observed.push(pinnedBlockRef.current);
    if (projectsBlockRef.current) observed.push(projectsBlockRef.current);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && observed.length > 0) {
      observer = new ResizeObserver(() => {
        recalculate();
      });
      for (const el of observed) observer.observe(el);
    }

    window.addEventListener('resize', recalculate);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', recalculate);
    };
  }, [enabled, layoutKey, recalculate]);

  return { previewLimit, scrollAreaRef, pinnedBlockRef, projectsBlockRef };
}
