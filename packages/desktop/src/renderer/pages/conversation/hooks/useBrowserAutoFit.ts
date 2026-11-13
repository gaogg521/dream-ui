import { planBrowserFit } from '@/renderer/pages/conversation/utils/layoutCalc';
import { useEffect, useRef } from 'react';

type UseBrowserAutoFitParams = {
  /** The preview panel is open on a browser tab (desktop only) */
  browserShown: boolean;
  containerWidth: number;
  workspaceEnabled: boolean;
  rightSiderCollapsed: boolean;
  setRightSiderCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  /** Effective workspace sider width in px while open */
  workspaceWidthPx: number;
  chatSplitRatio: number;
  /** Changes the ratio without persisting it */
  setChatSplitRatioTransient: (ratio: number) => void;
};

/**
 * Makes room when the in-app browser is shown: a web page needs far more width than
 * a document, but the default split leaves it ~40% of the window (less with the
 * workspace sider open), clipping the page.
 *
 * Runs once per "browser shown" session: shrinks the chat area (never below its
 * minimum) and collapses the workspace sider only if that is not enough. Both are
 * transient — nothing is persisted, and when the browser goes away the sider and
 * the ratio come back, unless the user touched them in the meantime.
 */
export function useBrowserAutoFit({
  browserShown,
  containerWidth,
  workspaceEnabled,
  rightSiderCollapsed,
  setRightSiderCollapsed,
  workspaceWidthPx,
  chatSplitRatio,
  setChatSplitRatioTransient,
}: UseBrowserAutoFitParams): void {
  const fittedRef = useRef(false);
  const autoCollapsedRef = useRef(false);
  const ratioRestoreRef = useRef<{ previous: number; applied: number } | null>(null);
  const latestRatioRef = useRef(chatSplitRatio);
  latestRatioRef.current = chatSplitRatio;

  // The user expanded the sider again by hand → it is theirs now, don't re-expand later.
  useEffect(() => {
    if (!rightSiderCollapsed) {
      autoCollapsedRef.current = false;
    }
  }, [rightSiderCollapsed]);

  useEffect(() => {
    if (!browserShown) {
      if (!fittedRef.current) {
        return;
      }
      fittedRef.current = false;
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        setRightSiderCollapsed(false);
      }
      const restore = ratioRestoreRef.current;
      ratioRestoreRef.current = null;
      // Only put it back if the user did not drag it since we changed it.
      if (restore && Math.abs(latestRatioRef.current - restore.applied) < 0.5) {
        setChatSplitRatioTransient(restore.previous);
      }
      return;
    }
    if (fittedRef.current || !containerWidth) {
      return;
    }
    fittedRef.current = true;
    const plan = planBrowserFit({
      containerWidth,
      workspaceWidthPx,
      workspaceVisible: workspaceEnabled && !rightSiderCollapsed,
      chatSplitRatio: latestRatioRef.current,
    });
    if (plan.collapseWorkspace) {
      autoCollapsedRef.current = true;
      setRightSiderCollapsed(true);
    }
    if (plan.chatRatio !== null && plan.chatRatio < latestRatioRef.current) {
      ratioRestoreRef.current = { previous: latestRatioRef.current, applied: plan.chatRatio };
      setChatSplitRatioTransient(plan.chatRatio);
    }
  }, [
    browserShown,
    containerWidth,
    workspaceEnabled,
    rightSiderCollapsed,
    setRightSiderCollapsed,
    workspaceWidthPx,
    setChatSplitRatioTransient,
  ]);
}
