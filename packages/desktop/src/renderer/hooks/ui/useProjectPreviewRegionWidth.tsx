/**
 * Copyright 2026 One Work
 */

/**
 * Layout-level width engine for the hoisted preview region (stage3 FULL / P4).
 *
 * For project conversations the preview panel is hoisted out of ChatLayout up to
 * the Layout host so it is structurally persistent (no remount across
 * same-project conversation switches). The Layout host row is then partitioned as
 * `[content(chat) | preview | explorer]`, all at the Layout level. This hook owns
 * the preview region width (resizable, persisted) and clamps it so chat keeps its
 * `MIN_CHAT_PANEL_PX` reserve *after* the explorer column has already taken its
 * (separately clamped) width — the two clamps are ordered so the sum can never
 * crowd chat below its minimum:
 *
 *   explorer ≤ available − MIN_CHAT − MIN_PREVIEW      (useProjectExplorerColumnWidth)
 *   preview  ≤ available − MIN_CHAT − explorerWidthPx  (here)
 *   ⇒ content = available − explorer − preview ≥ MIN_CHAT
 */

import { useEffect, useRef } from 'react';

import {
  BROWSER_PREFERRED_PANEL_PX,
  MIN_CHAT_PANEL_PX,
  MIN_PREVIEW_PANEL_PX,
  PREVIEW_REGION_CHROME_PX,
} from '@/renderer/pages/conversation/utils/layoutCalc';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

const DEFAULT_PREVIEW_REGION_PX = 480;
const MAX_PREVIEW_REGION_PX = 1200;

export type BrowserFitOptions = {
  /** The preview region is showing a browser tab */
  shown: boolean;
  /** Whether the explorer column is folded (width 0) */
  explorerCollapsed: boolean;
  /** Folds/unfolds the explorer column without persisting the choice */
  setExplorerCollapsed: (collapsed: boolean) => void;
};

export function useProjectPreviewRegionWidth(
  availableWidth: number,
  explorerWidthPx: number,
  active: boolean,
  browserFit?: BrowserFitOptions
) {
  const {
    splitRatio: requestedWidth,
    setSplitRatio,
    setSplitRatioTransient,
    createDragHandle,
  } = useResizableSplit({
    unit: 'px',
    defaultWidth: DEFAULT_PREVIEW_REGION_PX,
    minWidth: MIN_PREVIEW_PANEL_PX,
    maxWidth: MAX_PREVIEW_REGION_PX,
    storageKey: 'chat-preview-width-px',
  });

  // Clamp against the space left after chat's reserve and the explorer column,
  // minus the preview region's own horizontal chrome (margins + border) so the
  // occupied width (preview + chrome) never pushes the explorer past the row.
  const maxByContainer = Math.max(
    MIN_PREVIEW_PANEL_PX,
    availableWidth - MIN_CHAT_PANEL_PX - explorerWidthPx - PREVIEW_REGION_CHROME_PX
  );
  const widthPx = Math.min(requestedWidth, maxByContainer);

  // A web page needs more room than a document, but the default region (480px, less
  // next to the explorer) clips it. When the browser shows up: fold the explorer column
  // if chat's minimum + the explorer would still leave the page too narrow, then widen
  // the region to BROWSER_PREFERRED_PANEL_PX (chat gives way down to its minimum).
  // Everything is transient — nothing is persisted — and is handed back when the
  // browser goes away, unless the user touched the column / width in the meantime.
  const browserShown = Boolean(browserFit?.shown);
  const explorerCollapsed = Boolean(browserFit?.explorerCollapsed);
  const setExplorerCollapsed = browserFit?.setExplorerCollapsed;
  const requestedRef = useRef(requestedWidth);
  requestedRef.current = requestedWidth;
  const fitRef = useRef<{ widthApplied: number; widthPrevious: number | null } | null>(null);
  const autoFoldedRef = useRef(false);
  // Persist a shrink when the stored width no longer fits. Skipped for the single pass
  // in which the browser has just appeared: the effect below is about to fold the
  // explorer / widen the region, and saving the interim clamp would permanently
  // shrink the saved width for documents too.
  useEffect(() => {
    if (!active || availableWidth <= 0) return;
    if (browserShown && !fitRef.current) return;
    if (requestedWidth > maxByContainer) setSplitRatio(maxByContainer);
  }, [active, availableWidth, explorerWidthPx, requestedWidth, maxByContainer, setSplitRatio, browserShown]);

  useEffect(() => {
    // The user unfolded the column by hand: it is theirs now, never fold it back later.
    if (!explorerCollapsed) autoFoldedRef.current = false;
  }, [explorerCollapsed]);
  useEffect(() => {
    if (!browserShown || !active) {
      const fit = fitRef.current;
      fitRef.current = null;
      if (autoFoldedRef.current) {
        autoFoldedRef.current = false;
        setExplorerCollapsed?.(false);
      }
      if (fit && fit.widthPrevious !== null && Math.abs(requestedRef.current - fit.widthApplied) < 1) {
        setSplitRatioTransient(fit.widthPrevious);
      }
      return;
    }
    if (fitRef.current || availableWidth <= 0) return;
    const roomWithoutExplorer = availableWidth - MIN_CHAT_PANEL_PX - PREVIEW_REGION_CHROME_PX;
    const explorerVisible = !explorerCollapsed && explorerWidthPx > 0;
    const fold = explorerVisible && roomWithoutExplorer - explorerWidthPx < BROWSER_PREFERRED_PANEL_PX;
    const room = roomWithoutExplorer - (explorerVisible && !fold ? explorerWidthPx : 0);
    const target = Math.max(MIN_PREVIEW_PANEL_PX, Math.min(BROWSER_PREFERRED_PANEL_PX, room));
    fitRef.current = { widthApplied: target, widthPrevious: null };
    if (fold) {
      autoFoldedRef.current = true;
      setExplorerCollapsed?.(true);
    }
    if (requestedRef.current < target) {
      fitRef.current = { widthApplied: target, widthPrevious: requestedRef.current };
      setSplitRatioTransient(target);
    }
  }, [
    browserShown,
    active,
    availableWidth,
    explorerCollapsed,
    explorerWidthPx,
    setExplorerCollapsed,
    setSplitRatioTransient,
  ]);

  return { widthPx, createDragHandle };
}
