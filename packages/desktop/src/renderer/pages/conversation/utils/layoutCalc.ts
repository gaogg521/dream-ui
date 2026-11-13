// Layout constants for the chat layout panel sizing
export const MIN_CHAT_RATIO = 25;
export const MIN_PREVIEW_RATIO = 20;
export const WORKSPACE_HEADER_HEIGHT = 32;
export const MIN_CHAT_PANEL_PX = 360;
export const MIN_PREVIEW_PANEL_PX = 340;
export const MIN_WORKSPACE_PANEL_PX = 220;
export const MAX_WORKSPACE_PANEL_PX = 500;
export const DEFAULT_WORKSPACE_PANEL_PX = 260;
/**
 * Horizontal chrome of the Layout-hoisted preview region (stage3 FULL / P4):
 * its `ml-8` + `mr-12` margins + `1px` border on each side, plus a small
 * rounding buffer. The two width clamps must subtract this so the
 * [content | preview | explorer] row never exceeds the measured row width —
 * otherwise the preview's margins push the explorer column (and its right-side
 * button cluster) past the viewport edge at wider explorer widths.
 */
export const PREVIEW_REGION_CHROME_PX = 24;
/**
 * Width a browser page needs to render like a desktop site instead of being
 * clipped (the 340px document minimum is far too narrow for a web page).
 */
export const BROWSER_PREFERRED_PANEL_PX = 640;

export type BrowserFitInput = {
  containerWidth: number;
  /** Workspace sider width in px while it is open */
  workspaceWidthPx: number;
  workspaceVisible: boolean;
  chatSplitRatio: number;
};

export type BrowserFitPlan = {
  /** Collapse the workspace sider so the browser gets the room */
  collapseWorkspace: boolean;
  /** New chat ratio (percent) when the chat area has to give way; null = leave as is */
  chatRatio: number | null;
};

/**
 * Decide how to make room for a freshly shown browser panel: shrink the chat area
 * first (down to its minimum), and collapse the workspace sider only when that is
 * still not enough. Never grows the chat area.
 */
export const planBrowserFit = ({
  containerWidth,
  workspaceWidthPx,
  workspaceVisible,
  chatSplitRatio,
}: BrowserFitInput): BrowserFitPlan => {
  const wsPx = workspaceVisible ? workspaceWidthPx : 0;
  const collapseWorkspace = workspaceVisible && containerWidth - wsPx - MIN_CHAT_PANEL_PX < BROWSER_PREFERRED_PANEL_PX;
  const available = Math.max(containerWidth - (collapseWorkspace ? 0 : wsPx), 1);
  const currentPreviewPx = (available * (100 - chatSplitRatio)) / 100;
  if (currentPreviewPx >= BROWSER_PREFERRED_PANEL_PX) {
    return { collapseWorkspace, chatRatio: null };
  }
  const desiredChatPx = Math.max(MIN_CHAT_PANEL_PX, available - BROWSER_PREFERRED_PANEL_PX);
  const ratio = Math.max(MIN_CHAT_RATIO, Math.min(chatSplitRatio, (desiredChatPx / available) * 100));
  return { collapseWorkspace, chatRatio: ratio };
};

export type LayoutCalcInput = {
  containerWidth: number;
  /** 用户偏好的工作空间宽度（像素） */
  workspaceWidthPx: number;
  chatSplitRatio: number;
  workspaceEnabled: boolean;
  isDesktop: boolean;
  isPreviewOpen: boolean;
  rightSiderCollapsed: boolean;
  isMobile: boolean;
};

export type LayoutMetrics = {
  /** 桌面端工作空间生效宽度（像素，已根据容器宽度做上限收缩） */
  effectiveWorkspaceWidthPx: number;
  dynamicChatMinRatio: number;
  dynamicChatMaxRatio: number;
  /** 聊天区在主区域内的 flex-grow（preview 关闭时为 100，打开时按 chatSplitRatio 分配） */
  chatFlex: number;
  /** 工作空间最终展示像素：mobile 模式下走移动端值，桌面端等于 effectiveWorkspaceWidthPx */
  workspaceWidthPx: number;
  mobileWorkspaceWidthPx: number;
  titleAreaMaxWidth: number;
  mobileWorkspaceHandleRight: number;
};

/**
 * Compute all derived layout metrics. Workspace width is fixed px, not a
 * percentage of the container — the chat area absorbs viewport size changes.
 */
export const calcLayoutMetrics = (input: LayoutCalcInput): LayoutMetrics => {
  const {
    containerWidth,
    workspaceWidthPx: requestedWorkspaceWidthPx,
    chatSplitRatio,
    workspaceEnabled,
    isDesktop,
    isPreviewOpen,
    rightSiderCollapsed,
    isMobile,
  } = input;

  const safeContainerWidth = Math.max(containerWidth || 0, 1);

  // Workspace 在桌面端固定 px；当容器太窄时按上限收缩，但永远不小于 MIN
  const workspaceVisible = workspaceEnabled && isDesktop && !rightSiderCollapsed;
  const previewReservedPx = isPreviewOpen ? MIN_CHAT_PANEL_PX + MIN_PREVIEW_PANEL_PX : MIN_CHAT_PANEL_PX;
  const workspaceMaxByContainer = Math.max(MIN_WORKSPACE_PANEL_PX, safeContainerWidth - previewReservedPx);
  const effectiveWorkspaceWidthPx = workspaceVisible
    ? Math.max(
        MIN_WORKSPACE_PANEL_PX,
        Math.min(MAX_WORKSPACE_PANEL_PX, requestedWorkspaceWidthPx, workspaceMaxByContainer)
      )
    : 0;

  // 计算 chat / preview 之间的动态比例约束（基于剩余可用宽度）
  const availableWidthForChatPreview = Math.max(safeContainerWidth - effectiveWorkspaceWidthPx, 1);
  const minChatRatioByPx = (MIN_CHAT_PANEL_PX / availableWidthForChatPreview) * 100;
  const minPreviewRatioByPx = (MIN_PREVIEW_PANEL_PX / availableWidthForChatPreview) * 100;
  const dynamicChatMinRatio =
    workspaceEnabled && isDesktop && isPreviewOpen ? Math.max(MIN_CHAT_RATIO, minChatRatioByPx) : MIN_CHAT_RATIO;
  const dynamicChatMaxCandidate =
    workspaceEnabled && isDesktop && isPreviewOpen
      ? Math.min(80, 100 - Math.max(MIN_PREVIEW_RATIO, minPreviewRatioByPx))
      : 80;
  const dynamicChatMaxRatio = Math.max(dynamicChatMinRatio, dynamicChatMaxCandidate);

  // chat-area flex（外层 chat+preview 容器内的聊天面板的 flex-grow）：
  // preview 打开时按 chatSplitRatio 分配，否则聊天区独占
  const chatFlex = isDesktop ? (isPreviewOpen ? chatSplitRatio : 100) : 100;

  // 移动端工作空间宽度（覆盖式抽屉）
  const viewportWidth = containerWidth || (typeof window === 'undefined' ? 0 : window.innerWidth);
  const mobileWorkspaceWidthPx = Math.min(
    Math.max(300, Math.round(viewportWidth * 0.84)),
    Math.max(300, Math.min(420, viewportWidth - 20))
  );
  const workspaceWidthPx = workspaceEnabled ? (isMobile ? mobileWorkspaceWidthPx : effectiveWorkspaceWidthPx) : 0;

  const mobileWorkspaceHandleRight = rightSiderCollapsed ? 0 : Math.max(0, Math.round(workspaceWidthPx) - 14);
  const titleAreaMaxWidth = Math.max(320, Math.min(820, containerWidth - 520));

  return {
    effectiveWorkspaceWidthPx,
    dynamicChatMinRatio,
    dynamicChatMaxRatio,
    chatFlex,
    workspaceWidthPx,
    mobileWorkspaceWidthPx,
    titleAreaMaxWidth,
    mobileWorkspaceHandleRight,
  };
};
