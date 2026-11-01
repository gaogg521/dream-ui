/**
 * Copyright 2026 One Work
 */

import React, { useCallback } from 'react';
import { useCurrentConversation } from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { isTabVisibleInConversation, type PreviewTab, type PreviewTabPatch } from '../context/PreviewContext';
import BrowserViewer from './BrowserViewer';

export interface BrowserTabLayerProps {
  /** 所有浏览器类型的 tab / Every browser-type tab */
  browserTabs: PreviewTab[];
  /** 当前激活的 tab id（可能不是浏览器 tab）/ Active tab id (may not be a browser tab) */
  activeTabId: string | null;
  /** 回写 tab 字段 / Patch fields back onto a tab */
  updateTab: (tabId: string, patch: PreviewTabPatch) => void;
}

/**
 * 常驻挂载的浏览器层 / Always-mounted browser layer.
 *
 * 预览面板原本只渲染当前激活的 tab，对文档没问题，但对浏览器是致命的：
 * 切走再切回会重新加载页面，滚动位置、表单内容、未提交的操作全部丢失，
 * Agent 正在进行的操作也会被打断。
 *
 * 所以这一层把所有浏览器 tab 一直挂着，只切换可见性 —— webview 进程不销毁，
 * 页面状态完整保留。非激活的 tab 用 visibility 隐藏而不是 display:none，
 * 这样它们仍有真实尺寸，切回来时不需要重新布局。
 *
 * The preview panel renders only the active tab, which is fine for documents but
 * fatal for a browser: switching away and back would reload the page, losing
 * scroll position, form input, and any in-flight agent operation. This layer keeps
 * every browser tab mounted and only toggles visibility, so the webview process
 * survives. Inactive tabs are hidden via `visibility` rather than `display:none`
 * so they retain real dimensions and need no relayout when shown again.
 */
const BrowserTabLayer: React.FC<BrowserTabLayerProps> = ({ browserTabs, activeTabId, updateTab }) => {
  // 浏览器页签跟随会话：webview 仍全部常驻（切会话不销毁、页面状态不丢），
  // 只有「归属当前会话且被激活」的 tab 可见 —— 别的会话打开的网站不会出现在这里。
  // Browser tabs follow their conversation: every webview stays mounted (switching
  // conversations neither destroys them nor loses page state), but only a tab that
  // is owned by the current conversation AND active is shown — a site opened in
  // another conversation never appears here.
  const currentConversationId = useCurrentConversation();

  const handleUrlChange = useCallback(
    (tabId: string, url: string) => {
      // 地址存在 content 里，与其他 tab 类型保持一致 / Address lives in content, like other tab types
      updateTab(tabId, { content: url });
    },
    [updateTab]
  );

  const handleTitleChange = useCallback((tabId: string, title: string) => updateTab(tabId, { title }), [updateTab]);

  const handleFaviconChange = useCallback(
    (tabId: string, favicon: string) => updateTab(tabId, { metadata: { favicon } }),
    [updateTab]
  );

  if (browserTabs.length === 0) return null;

  const isBrowserActive = browserTabs.some(
    (tab) => tab.id === activeTabId && isTabVisibleInConversation(tab, currentConversationId)
  );

  return (
    <div className='relative flex-1 overflow-hidden' style={{ display: isBrowserActive ? undefined : 'none' }}>
      {browserTabs.map((tab) => {
        const isActive = tab.id === activeTabId && isTabVisibleInConversation(tab, currentConversationId);
        return (
          <div
            key={tab.id}
            className='absolute inset-0 flex flex-col'
            style={{
              visibility: isActive ? 'visible' : 'hidden',
              pointerEvents: isActive ? undefined : 'none',
              zIndex: isActive ? 1 : 0,
            }}
          >
            <BrowserViewer
              url={tab.content}
              tabId={tab.id}
              onUrlChange={handleUrlChange}
              onTitleChange={handleTitleChange}
              onFaviconChange={handleFaviconChange}
            />
          </div>
        );
      })}
    </div>
  );
};

export default BrowserTabLayer;
