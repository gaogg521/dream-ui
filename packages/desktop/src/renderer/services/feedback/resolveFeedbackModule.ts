/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FeedbackModuleTag } from '@/common/types/feedbackDiagnostics';

/**
 * Ordered route-prefix → feedback-module mapping used by the titlebar report
 * button, so the feedback modal pre-selects the module matching the page the
 * user is on. Tags must exist in FEEDBACK_MODULES (feedbackDiagnostics.ts).
 *
 * More specific prefixes must come before shorter ones (e.g. `/settings/agent`
 * before the `/settings` fallback). Legacy redirect-only routes (like
 * `/settings/display`) never appear here because the router replaces them
 * before the user can click the report button.
 */
const ROUTE_MODULE_MAP: ReadonlyArray<readonly [prefix: string, tag: FeedbackModuleTag]> = [
  ['/conversation', 'conversation-session'],
  ['/team', 'agent-team'],
  ['/scheduled', 'scheduled-task'],
  ['/assistants', 'assistant-preset'],
  ['/settings/agent', 'agent-detection'],
  ['/settings/model', 'model-auth'],
  ['/settings/skills', 'skills-plugin'],
  ['/settings/tools', 'mcp-tools'],
  // Super Assistant / Memory, previously top-level pages, now live under
  // Settings as a dedicated low-usage "Tools" group. Same tags their old
  // top-level routes used, before those became redirect-only.
  ['/settings/super-assistant', 'other'],
  ['/settings/memory', 'conversation-session'],
  ['/settings/appearance', 'display-desktop'],
  ['/settings/pet', 'display-desktop'],
  ['/settings/webui', 'webui-remote'],
  // Extension-contributed settings tabs are channel plugins (Telegram/Slack/
  // Feishu…) today, so route their reports to the channel module.
  ['/settings/ext', 'channel'],
  // Fork-only enterprise surfaces (`/enterprise/login`, `/enterprise/console`,
  // and the `/enterprise` redirect). Same bucket as `/settings/enterprise`,
  // which the `/settings` fallback below already routes to system-settings.
  ['/enterprise', 'system-settings'],
  // Fork-only top-level pages that stay outside the settings tree. `/mcp` and
  // `/sessions` are real pages; `/super-assistant`, `/skills`, and `/memory`
  // are now redirect-only aliases for their `/settings/*` counterparts above,
  // but the router still contains those literal paths so they still need an
  // entry here (same tag as their new home) rather than falling through
  // undefined.
  ['/mcp', 'mcp-tools'],
  ['/sessions', 'search-history'],
  ['/super-assistant', 'other'],
  ['/skills', 'skills-plugin'],
  ['/memory', 'conversation-session'],
  // Remaining settings routes (system, about, unknown future tabs).
  ['/settings', 'system-settings'],
];

/**
 * Map the current route to a feedback module tag. Unknown routes (e.g. the
 * home page) return undefined, letting the user pick the module themselves.
 */
export const resolveFeedbackModule = (pathname: string): FeedbackModuleTag | undefined => {
  return ROUTE_MODULE_MAP.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1];
};
