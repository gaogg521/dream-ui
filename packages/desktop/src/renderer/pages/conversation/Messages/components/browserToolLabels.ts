/**
 * Copyright 2026 One Work
 */

import { BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';

/**
 * 把内置浏览器 MCP 的工具名翻译成用户读得懂的动作词。
 *
 * Agent 视角里这是 `one-browser__navigate_page`，用户看到的就是一串机器名 ——
 * 这是「用户不知道智能体在操作浏览器」的直接原因之一。这里按 chrome-devtools-mcp
 * 的工具清单给每个动作一个 i18n 标签；映射之外的工具返回 null，调用方退回原名。
 *
 * Translates built-in browser MCP tool names into labels a user can read. The
 * agent sees `one-browser__navigate_page`, the user sees a machine name — one of
 * the direct reasons browser automation goes unnoticed. Each chrome-devtools-mcp
 * tool gets an i18n label; unknown tools return null and the caller falls back
 * to the raw name.
 */

/** chrome-devtools-mcp tool name → i18n key under preview.browser.tool */
const TOOL_LABEL_KEYS: Record<string, string> = {
  navigate_page: 'navigatePage',
  navigate_page_history: 'navigateHistory',
  new_page: 'newPage',
  list_pages: 'listPages',
  select_page: 'selectPage',
  close_page: 'closePage',
  wait_for: 'waitFor',
  take_screenshot: 'takeScreenshot',
  take_snapshot: 'takeSnapshot',
  click: 'click',
  hover: 'hover',
  drag: 'drag',
  fill: 'fill',
  fill_form: 'fillForm',
  handle_dialog: 'handleDialog',
  resize_page: 'resizePage',
  evaluate_script: 'evaluateScript',
  list_console_messages: 'listConsoleMessages',
  list_network_requests: 'listNetworkRequests',
};

/** Strips `mcp__<server>__` / `<server>__` wrappers and trailing annotations. */
export function normalizeBrowserToolName(toolName: string): string {
  let name = toolName ?? '';
  const mcpPrefix = `mcp__${BUILTIN_BROWSER_MCP_NAME}__`;
  const serverPrefix = `${BUILTIN_BROWSER_MCP_NAME}__`;
  if (name.startsWith(mcpPrefix)) name = name.slice(mcpPrefix.length);
  else if (name.startsWith(serverPrefix)) name = name.slice(serverPrefix.length);
  // Other engines wrap as `<server>__<tool>` with their own server name, or
  // append "(chrome-devtools MCP Server)" — keep only the trailing tool token.
  if (name.includes('__')) name = name.split('__').pop() || name;
  name = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return name.toLowerCase();
}

/** Whether this tool call belongs to the built-in browser MCP. */
export function isBrowserToolName(toolName: string): boolean {
  const name = toolName ?? '';
  return name.startsWith(`${BUILTIN_BROWSER_MCP_NAME}__`) || name.startsWith(`mcp__${BUILTIN_BROWSER_MCP_NAME}__`);
}

/**
 * i18n key for a browser tool call, or null when it is not a known browser tool.
 * `key` is under preview.browser.tool; callers run it through t().
 */
export function browserToolLabelKey(toolName: string): string | null {
  const base = normalizeBrowserToolName(toolName);
  const key = TOOL_LABEL_KEYS[base];
  if (!key) return null;
  // Only the built-in server's tools carry the label; another MCP exposing a
  // colliding tool name must keep its raw name.
  if (!isBrowserToolName(toolName) && !toolName.toLowerCase().includes('chrome')) return null;
  return `preview.browser.tool.${key}`;
}

/**
 * Display name for a tool call: the translated action for browser tools, the
 * raw name otherwise. Single entry point for both tool-call renderers.
 */
export function browserToolDisplayName(toolName: string, t: (key: string) => string): string {
  const key = browserToolLabelKey(toolName);
  return key ? t(key) : toolName;
}
