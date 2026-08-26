/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';

/**
 * 团队作战记录导出 —— 数据契约。
 *
 * 采集层（collectTeamTranscript）只负责「把库里的东西取全并归一化」，渲染层
 * （renderTeamTranscriptHtml）只负责「把归一化结果画成单文件 HTML」。两层之间靠本文件
 * 的类型对齐，互不知道对方的实现，便于分别单测。
 */

/** 导出产物里的一个成员（= 团队里的一个 slot，一个独立会话）。 */
export type TranscriptMember = {
  slot_id: string;
  conversation_id: string;
  /** 成员显示名（助手名，可能被用户重命名过）。 */
  name: string;
  /** 后端标识：claude / codex / dream / ... */
  backend: string;
  model?: string;
  /** true = 团队 Leader。 */
  isLeader: boolean;
  /**
   * 身份色，必须是**具体颜色值**（如 `#5c9ea4`）。
   * 界面里的色板含 `var(--brand)`，导出前要按当前主题解析成字面值，否则产物离开应用就掉色。
   */
  color: string;
  /** 实际收进产物的消息条数（已排除 hidden / available_commands）。 */
  messageCount: number;
  /** 该成员是否因为条数上限被截断（截断会在产物页首明示，不静默）。 */
  truncated: boolean;
};

/** 一条消息在全局时间线上的位置。 */
export type TranscriptEntry = {
  /** 消息自身 id，用作 DOM id。 */
  id: string;
  slot_id: string;
  /**
   * 排序用时间戳（毫秒）。created_at 缺失时沿用同成员上一条的时间戳，
   * 保证「成员内相对顺序」永不被打乱。
   */
  sortAt: number;
  /** 消息真实 created_at；缺失时为 undefined（产物里不显示时间）。 */
  createdAt?: number;
  message: TMessage;
};

export type TranscriptTeamInfo = {
  id: string;
  name: string;
  workspace?: string;
  session_mode?: string;
  created_at?: number;
};

/** 采集结果 —— 渲染层的唯一输入。 */
export type TeamTranscript = {
  team: TranscriptTeamInfo;
  /** 导出时刻（毫秒）。由调用方注入，方便测试固定时间。 */
  exportedAt: number;
  members: TranscriptMember[];
  /** 全局时间升序；成员内相对顺序稳定。 */
  entries: TranscriptEntry[];
  /** 绝对路径 -> data URI。渲染层只查表，查不到就退化成「只显示路径」。 */
  images: Record<string, string>;
  /**
   * 需要如实告诉用户的事：截断了多少、几张图没取到、哪个成员拉取失败。
   * 渲染层把它原样印在产物页首 —— 不静默丢东西。
   */
  notes: TranscriptNote[];
};

export type TranscriptNote =
  | { kind: 'member_truncated'; slot_id: string; name: string; kept: number }
  | { kind: 'member_failed'; slot_id: string; name: string; reason: string }
  | { kind: 'images_failed'; count: number }
  | { kind: 'images_skipped'; count: number };
