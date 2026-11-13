/**
 * Copyright 2026 One Work
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePreviewContext } from '../context/PreviewContext';
import BrowserTabLayer from './BrowserTabLayer';

/**
 * 面板收起 / 没有占位元素时，宿主停靠的位置：屏幕外，但保留真实尺寸。
 * 不用 display:none —— 那样 webview 拿不到布局，截图、滚动、定时器都会走样；
 * 屏幕外的真实尺寸让页面照常渲染，Agent 通过 CDP 驱动时行为与可见时一致。
 *
 * Where the host parks while the panel is closed / has no slot: off-screen but at a real
 * size. Not display:none — the webview would get no layout, skewing screenshots, scrolling
 * and timers; a real size off-screen lets the page render normally, so driving it over CDP
 * behaves the same as when it is visible.
 */
const PARKED_STYLE: Pick<React.CSSProperties, 'left' | 'top' | 'width' | 'height' | 'pointerEvents'> = {
  left: -20000,
  top: 0,
  width: 1024,
  height: 768,
  pointerEvents: 'none',
};

/**
 * 全局浏览器宿主：把所有浏览器 tab 的 webview 挂在应用根部，**不依赖预览面板是否打开**。
 *
 * 为什么要提出来：webview 原来渲染在 PreviewPanel 里，而面板收起时 PreviewPanel 直接
 * 返回空 —— 浏览器视图随之不存在，智能体没有任何东西可连，只能报「not attached」，用户
 * 得先手动打开面板。更糟的是，别的会话的智能体想用浏览器时，只能把面板开在用户正在看的
 * 会话里。现在 webview 常驻在这里，面板只提供一个「占位元素」，宿主用 fixed 定位贴在它上面
 * （portal 到 body，不受任何祖先 transform 影响）。面板开合、切会话都不会重载页面。
 *
 * Global browser host: mounts every browser tab's webview at the app root, independent of
 * whether the preview panel is open.
 *
 * Why it was lifted out: the webview used to render inside PreviewPanel, which returns null
 * while the panel is closed — so the browser view did not exist and the agent had nothing to
 * connect to, failing with "not attached" until the user opened the panel by hand. Worse, an
 * agent in another conversation could only surface the panel inside whatever conversation
 * the user was viewing. Now the webviews live here permanently; the panel just provides a
 * placeholder element and the host sits over it with fixed positioning (portalled to body,
 * so no ancestor transform can skew it). Opening/closing the panel or switching
 * conversations never reloads a page.
 */
const BrowserHost: React.FC = () => {
  const { tabs, activeTabId, updateTab, browserSlot } = usePreviewContext();
  const hostRef = useRef<HTMLDivElement>(null);
  const browserTabs = tabs.filter((tab) => tab.content_type === 'browser');
  const hasBrowserTabs = browserTabs.length > 0;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const park = () => {
      host.style.left = `${PARKED_STYLE.left}px`;
      host.style.top = `${PARKED_STYLE.top}px`;
      host.style.width = `${PARKED_STYLE.width}px`;
      host.style.height = `${PARKED_STYLE.height}px`;
      host.style.pointerEvents = 'none';
    };

    if (!browserSlot) {
      park();
      return;
    }

    /**
     * 占位元素的位置会因拖拽分栏、最大化、侧边栏折叠、窗口缩放而变，且位置变化不一定伴随
     * 尺寸变化（ResizeObserver 看不到），所以逐帧读取矩形、只在变化时写样式。直接写 DOM，
     * 不走 React 状态，避免每次移动都重渲染。
     *
     * The slot moves with split dragging, maximizing, sidebar collapse and window resizes,
     * and a move does not always change its size (invisible to ResizeObserver), so read the
     * rect every frame and write styles only on change. Written straight to the DOM rather
     * than through React state, so a move never triggers a re-render.
     */
    let frame = 0;
    let last = '';
    const follow = () => {
      if (browserSlot.isConnected) {
        const rect = browserSlot.getBoundingClientRect();
        const key = `${rect.left}|${rect.top}|${rect.width}|${rect.height}`;
        if (key !== last) {
          last = key;
          if (rect.width > 0 && rect.height > 0) {
            host.style.left = `${rect.left}px`;
            host.style.top = `${rect.top}px`;
            host.style.width = `${rect.width}px`;
            host.style.height = `${rect.height}px`;
            host.style.pointerEvents = '';
          } else {
            // 占位元素在，但此刻没有浏览器内容要显示（激活的是文档 tab）。
            // Slot exists but nothing browser-related is on show (a document tab is active).
            park();
          }
        }
      } else if (last !== 'gone') {
        last = 'gone';
        park();
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [browserSlot]);

  if (!hasBrowserTabs) return null;

  return createPortal(
    <div
      ref={hostRef}
      data-testid='browser-host'
      className='flex flex-col overflow-hidden'
      style={{ position: 'fixed', zIndex: 5, ...PARKED_STYLE }}
    >
      <BrowserTabLayer
        browserTabs={browserTabs}
        activeTabId={activeTabId}
        updateTab={updateTab}
        panelVisible={Boolean(browserSlot)}
      />
    </div>,
    document.body
  );
};

export default BrowserHost;
