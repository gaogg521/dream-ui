/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 导出产物里出现的全部文案。
 *
 * 产物是**离线单文件**，打开时没有 i18n 运行时，所以导出那一刻就要把当前语言的文案
 * 全部烧进去。渲染层只认这个对象，不认 `t()` —— 这样渲染层能在 node 环境里直接单测。
 */
export type TranscriptLabels = {
  documentTitle: string;
  workspace: string;
  sessionMode: string;
  exportedAt: string;
  memberCount: string;
  messageCount: string;
  leader: string;
  /** 视图切换 */
  viewLanes: string;
  viewTimeline: string;
  /** 工具条 */
  filterMembers: string;
  searchPlaceholder: string;
  expandAll: string;
  collapseAll: string;
  noMatch: string;
  emptyMember: string;
  /** 消息骨架 */
  you: string;
  fromTeammate: string;
  thinking: string;
  thinkingSeconds: string;
  toolCall: string;
  toolInput: string;
  toolOutput: string;
  toolLocations: string;
  fullText: string;
  plan: string;
  permissionRequest: string;
  permissionOptions: string;
  diff: string;
  diffBefore: string;
  diffAfter: string;
  imageMissing: string;
  longBody: string;
  unknownType: string;
  /** 状态徽标 */
  statusPending: string;
  statusRunning: string;
  statusDone: string;
  statusFailed: string;
  statusCanceled: string;
  /** 页首提示区 */
  notesTitle: string;
  noteTruncated: string;
  noteMemberFailed: string;
  noteImagesFailed: string;
  noteImagesSkipped: string;
  disclaimer: string;
};

type Translate = (key: string, options: { defaultValue: string } & Record<string, unknown>) => string;

/**
 * 从 i18n 取全部导出文案。
 *
 * 每个 key 都带 `defaultValue`：未翻译的语言退化成英文，而不是把 key 印到产物里。
 * 带 `{...}` 的条目由渲染层用 `fillLabel` 替换，所以这里保留占位符原样。
 */
export const buildTranscriptLabels = (t: Translate): TranscriptLabels => ({
  documentTitle: t('team.export.documentTitle', { defaultValue: 'Team transcript' }),
  workspace: t('team.export.workspace', { defaultValue: 'Workspace' }),
  sessionMode: t('team.export.sessionMode', { defaultValue: 'Permission mode' }),
  exportedAt: t('team.export.exportedAt', { defaultValue: 'Exported at' }),
  memberCount: t('team.export.memberCount', { defaultValue: 'Members' }),
  messageCount: t('team.export.messageCount', { defaultValue: 'Messages' }),
  leader: t('team.export.leader', { defaultValue: 'Leader' }),
  viewLanes: t('team.export.viewLanes', { defaultValue: 'Columns' }),
  viewTimeline: t('team.export.viewTimeline', { defaultValue: 'Timeline' }),
  filterMembers: t('team.export.filterMembers', { defaultValue: 'Members' }),
  searchPlaceholder: t('team.export.searchPlaceholder', { defaultValue: 'Filter by keyword' }),
  expandAll: t('team.export.expandAll', { defaultValue: 'Expand all' }),
  collapseAll: t('team.export.collapseAll', { defaultValue: 'Collapse all' }),
  noMatch: t('team.export.noMatch', { defaultValue: 'Nothing matches the current filter.' }),
  emptyMember: t('team.export.emptyMember', { defaultValue: 'No messages.' }),
  you: t('team.export.you', { defaultValue: 'You' }),
  fromTeammate: t('team.export.fromTeammate', { defaultValue: 'From {name}' }),
  thinking: t('team.export.thinking', { defaultValue: 'Thinking' }),
  thinkingSeconds: t('team.export.thinkingSeconds', { defaultValue: 'Thought for {seconds}s' }),
  toolCall: t('team.export.toolCall', { defaultValue: 'Tool call' }),
  toolInput: t('team.export.toolInput', { defaultValue: 'Input' }),
  toolOutput: t('team.export.toolOutput', { defaultValue: 'Output' }),
  toolLocations: t('team.export.toolLocations', { defaultValue: 'Files touched' }),
  fullText: t('team.export.fullText', { defaultValue: 'Full text' }),
  plan: t('team.export.plan', { defaultValue: 'Plan' }),
  permissionRequest: t('team.export.permissionRequest', { defaultValue: 'Permission request' }),
  permissionOptions: t('team.export.permissionOptions', { defaultValue: 'Options' }),
  diff: t('team.export.diff', { defaultValue: 'Diff' }),
  diffBefore: t('team.export.diffBefore', { defaultValue: 'Before' }),
  diffAfter: t('team.export.diffAfter', { defaultValue: 'After' }),
  imageMissing: t('team.export.imageMissing', { defaultValue: '[image not embedded]' }),
  longBody: t('team.export.longBody', { defaultValue: 'full message, {chars} chars' }),
  unknownType: t('team.export.unknownType', { defaultValue: 'Unsupported message type: {type}' }),
  statusPending: t('team.export.statusPending', { defaultValue: 'Pending' }),
  statusRunning: t('team.export.statusRunning', { defaultValue: 'Running' }),
  statusDone: t('team.export.statusDone', { defaultValue: 'Done' }),
  statusFailed: t('team.export.statusFailed', { defaultValue: 'Failed' }),
  statusCanceled: t('team.export.statusCanceled', { defaultValue: 'Canceled' }),
  notesTitle: t('team.export.notesTitle', { defaultValue: 'Notes about this export' }),
  noteTruncated: t('team.export.noteTruncated', {
    defaultValue: '{name}: history exceeded the export cap, only the latest {kept} messages are included.',
  }),
  noteMemberFailed: t('team.export.noteMemberFailed', {
    defaultValue: '{name}: failed to load history ({reason}).',
  }),
  noteImagesFailed: t('team.export.noteImagesFailed', {
    defaultValue: '{count} image(s) could not be read from disk; their paths are shown instead.',
  }),
  noteImagesSkipped: t('team.export.noteImagesSkipped', {
    defaultValue: '{count} image(s) were too large to embed; their paths are shown instead.',
  }),
  disclaimer: t('team.export.disclaimer', {
    defaultValue: 'Offline snapshot generated by the app. Tool output is included verbatim — handle with care.',
  }),
});

/**
 * `{name}` 占位符替换。
 *
 * 刻意用单花括号：i18next 的 `{{x}}` 在缺少插值时会被替换成空串，而这些模板要原样带到
 * 产物里再填，所以不能让 i18next 在 `t()` 阶段就动它们。
 */
export const fillLabel = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (all, key: string) => {
    const value = values[key];
    return value === undefined ? all : String(value);
  });
