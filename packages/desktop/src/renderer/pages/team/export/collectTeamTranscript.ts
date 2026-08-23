/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getAcpImagePath } from '@/common/chat/acpToolCallOutput';
import { joinPath, type TMessage } from '@/common/chat/chatLib';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import { loadConversationMessagePage } from '@/renderer/utils/chat/messagePagination';
import type {
  TeamTranscript,
  TranscriptEntry,
  TranscriptMember,
  TranscriptNote,
  TranscriptTeamInfo,
} from './teamTranscriptTypes';

/** 后端单页上限（MAX_MESSAGE_PAGE_LIMIT），取满以减少往返。 */
const PAGE_LIMIT = 200;
/** 每成员最多翻多少页 —— 4 万条的天花板，防跑飞；命中会在产物里明示。 */
const MAX_PAGES_PER_MEMBER = 200;
/** 图片内嵌并发度：走本机后端，4 路够用且不会把后端打满。 */
const IMAGE_CONCURRENCY = 4;
/** 单张图内嵌上限（data URI 字节）。超大图只留路径，避免产物膨胀到打不开。 */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

export type TranscriptDeps = {
  getMessages: (params: {
    conversation_id: string;
    limit?: number;
    before?: string;
  }) => Promise<MessageCursorPage<TMessage> | null | undefined>;
  getImageDataUrl: (path: string, workspace?: string) => Promise<string | null | undefined>;
};

export const defaultTranscriptDeps: TranscriptDeps = {
  // 走既有的单页原语：请求形状（content_mode 等）只在 messagePagination 里定义一次。
  // 「怎么翻页」留在本模块，因为导出还需要页数上限与游标停滞保护。
  getMessages: ({ conversation_id, limit, before }) =>
    loadConversationMessagePage(conversation_id, { limit, before, contentMode: 'full' }),
  getImageDataUrl: (path, workspace) => ipcBridge.fs.getImageBase64.invoke({ path, workspace }),
};

export type TranscriptMemberInput = Omit<TranscriptMember, 'messageCount' | 'truncated'>;

export type TranscriptProgress = {
  phase: 'messages' | 'images';
  /** 已完成单位数（成员数 / 图片数）。 */
  done: number;
  total: number;
  /** 当前处理对象名，用于按钮上的进度提示。 */
  label?: string;
};

export type CollectTeamTranscriptParams = {
  team: TranscriptTeamInfo;
  members: TranscriptMemberInput[];
  /** 是否把图片转成 data URI 内嵌（产物自包含但体积上涨）。 */
  includeImages: boolean;
  /** 导出时刻，由调用方注入以便测试固定时间。 */
  exportedAt: number;
  deps?: TranscriptDeps;
  onProgress?: (progress: TranscriptProgress) => void;
};

/** UI 不显示的两类消息：hidden（注入给 agent 的内部内容）与 available_commands（能力清单）。 */
const isDisplayableMessage = (message: TMessage): boolean => !message.hidden && message.type !== 'available_commands';

const isRemoteOrInlineSrc = (src: string): boolean =>
  src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:');

const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)/g;

/** 从一条消息里挖出所有「本机图片引用」，返回消息里原样出现的 src 字符串。 */
export const collectImageRefs = (message: TMessage): string[] => {
  const refs: string[] = [];
  const push = (src: unknown) => {
    if (typeof src !== 'string') return;
    const trimmed = src.trim();
    if (!trimmed || isRemoteOrInlineSrc(trimmed)) return;
    refs.push(trimmed);
  };

  if (message.type === 'text' || message.type === 'thinking') {
    const content = (message.content as { content?: string }).content ?? '';
    for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
      try {
        push(decodeURIComponent(match[1]));
      } catch {
        push(match[1]);
      }
    }
  } else if (message.type === 'acp_tool_call') {
    push(getAcpImagePath(message.content.update));
  } else if (message.type === 'tool_group') {
    for (const item of message.content ?? []) {
      const display = item?.result_display;
      if (display && typeof display === 'object' && 'img_url' in display) push(display.img_url);
    }
  }

  return refs;
};

/** 相对路径按团队工作区补全成绝对路径（与界面里 LocalImageView 同一套规则）。 */
const resolveImagePath = (src: string, workspace?: string): string => {
  if (!workspace) return src;
  if (src.startsWith('/') || src.startsWith('\\') || src.startsWith('file:') || /^[A-Za-z]:/.test(src)) return src;
  return joinPath(workspace, src);
};

type MemberFetchResult = {
  messages: TMessage[];
  truncated: boolean;
};

/** 从最新一页往回翻，直到没有更早的消息或撞上页数上限。 */
export const fetchMemberMessages = async (
  conversation_id: string,
  deps: TranscriptDeps
): Promise<MemberFetchResult> => {
  const pages: TMessage[][] = [];
  let before: string | undefined;
  let truncated = false;

  for (let pageIndex = 0; ; pageIndex++) {
    if (pageIndex >= MAX_PAGES_PER_MEMBER) {
      truncated = true;
      break;
    }
    const page = await deps.getMessages({ conversation_id, limit: PAGE_LIMIT, before });
    const items = page?.items ?? [];
    // 后端每页按时间升序返回，越往后翻越早，所以整页往前插。
    if (items.length > 0) pages.unshift(items);
    if (!page?.has_more_before || !page.oldest_cursor) break;
    // 游标没推进说明后端在原地打转，当截断处理，别死循环。
    if (page.oldest_cursor === before) {
      truncated = true;
      break;
    }
    before = page.oldest_cursor;
  }

  const seen = new Set<string>();
  const messages: TMessage[] = [];
  for (const page of pages) {
    for (const message of page) {
      if (!message?.id || seen.has(message.id)) continue;
      seen.add(message.id);
      if (!isDisplayableMessage(message)) continue;
      messages.push(message);
    }
  }

  return { messages, truncated };
};

type OrderedEntry = TranscriptEntry & { __order: number };

/**
 * 采集整支团队的作战记录。
 *
 * 逐成员拉全量历史（一个成员 = 一个会话），按 created_at 归并成一条全局时间线，
 * 并保证「同一成员内部的相对顺序」不被时间戳缺失打乱。
 */
export const collectTeamTranscript = async ({
  team,
  members,
  includeImages,
  exportedAt,
  deps = defaultTranscriptDeps,
  onProgress,
}: CollectTeamTranscriptParams): Promise<TeamTranscript> => {
  const notes: TranscriptNote[] = [];
  const resolvedMembers: TranscriptMember[] = [];
  const ordered: OrderedEntry[] = [];

  for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
    const member = members[memberIndex];
    onProgress?.({ phase: 'messages', done: memberIndex, total: members.length, label: member.name });

    let fetched: MemberFetchResult = { messages: [], truncated: false };
    if (member.conversation_id) {
      try {
        fetched = await fetchMemberMessages(member.conversation_id, deps);
      } catch (error) {
        notes.push({
          kind: 'member_failed',
          slot_id: member.slot_id,
          name: member.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // created_at 缺失时沿用上一条的时间戳，成员内顺序因此永远稳定。
    let lastAt = 0;
    fetched.messages.forEach((message, localIndex) => {
      const createdAt = typeof message.created_at === 'number' ? message.created_at : undefined;
      if (createdAt !== undefined) lastAt = createdAt;
      ordered.push({
        id: message.id,
        slot_id: member.slot_id,
        sortAt: lastAt,
        createdAt,
        message,
        // 时间戳并列时的稳定兜底键，排完即弃。
        __order: memberIndex * 1e7 + localIndex,
      });
    });

    resolvedMembers.push({ ...member, messageCount: fetched.messages.length, truncated: fetched.truncated });
    if (fetched.truncated) {
      notes.push({
        kind: 'member_truncated',
        slot_id: member.slot_id,
        name: member.name,
        kept: fetched.messages.length,
      });
    }
  }
  onProgress?.({ phase: 'messages', done: members.length, total: members.length });

  ordered.sort((a, b) => a.sortAt - b.sortAt || a.__order - b.__order);
  const entries: TranscriptEntry[] = ordered.map(({ __order: _order, ...entry }) => entry);

  const images: Record<string, string> = {};
  if (includeImages) {
    const pending = Array.from(new Set(entries.flatMap((entry) => collectImageRefs(entry.message))));
    const total = pending.length;
    let failed = 0;
    let skipped = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const ref = pending.shift();
        if (ref === undefined) return;
        try {
          const dataUrl = await deps.getImageDataUrl(resolveImagePath(ref, team.workspace), team.workspace);
          if (!dataUrl) failed++;
          else if (dataUrl.length > MAX_INLINE_IMAGE_BYTES) skipped++;
          else images[ref] = dataUrl;
        } catch {
          failed++;
        }
        done++;
        onProgress?.({ phase: 'images', done, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, total) }, worker));
    if (failed > 0) notes.push({ kind: 'images_failed', count: failed });
    if (skipped > 0) notes.push({ kind: 'images_skipped', count: skipped });
  }

  return { team, exportedAt, members: resolvedMembers, entries, images, notes };
};
