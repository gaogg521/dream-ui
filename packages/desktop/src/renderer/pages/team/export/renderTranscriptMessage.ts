/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { escapeAttr, escapeHtml, renderMarkdown, renderPlainText, type MarkdownContext } from './transcriptMarkdown';
import { fillLabel, type TranscriptLabels } from './transcriptLabels';
import type { TranscriptEntry, TranscriptMember } from './teamTranscriptTypes';

/** 超过这个行数就不算行级 diff（O(n·m) 会把导出卡死），退化成前后两块。 */
const DIFF_LINE_BUDGET = 1200;
/**
 * 超过这个字数的正文默认折叠。真机数据里单条消息能到四万字（整份规格书、一大段 JSON 目录），
 * 摊开会把整条时间线埋掉。折叠不丢任何内容，摘要里明写字数，点开就是完整正文。
 */
const LONG_BODY_CHARS = 6000;

export type MessageRenderContext = {
  labels: TranscriptLabels;
  markdown: MarkdownContext;
};

type StatusTone = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

const statusText = (tone: StatusTone, labels: TranscriptLabels): string => {
  if (tone === 'pending') return labels.statusPending;
  if (tone === 'running') return labels.statusRunning;
  if (tone === 'failed') return labels.statusFailed;
  if (tone === 'canceled') return labels.statusCanceled;
  return labels.statusDone;
};

/** 各后端的状态词表并不统一，收口成 5 种色调。 */
const toneOf = (raw: string | undefined): StatusTone => {
  switch (raw) {
    case 'pending':
    case 'Pending':
    case 'Confirming':
      return 'pending';
    case 'running':
    case 'in_progress':
    case 'Executing':
      return 'running';
    case 'error':
    case 'failed':
    case 'Error':
      return 'failed';
    case 'Canceled':
      return 'canceled';
    default:
      return 'done';
  }
};

const badge = (tone: StatusTone, labels: TranscriptLabels): string =>
  `<span class="tx-badge tx-badge-${tone}">${escapeHtml(statusText(tone, labels))}</span>`;

const pad = (value: number): string => String(value).padStart(2, '0');

/** 本地时间的 `YYYY-MM-DD HH:mm:ss`。产物是快照，用导出机器的时区即可。 */
export const formatDisplayTime = (ts: number): string => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

/** 抬头最多显示多少字符；再长就折进折叠块，不截断内容。 */
const TITLE_HEAD_CHARS = 120;

/**
 * 工具抬头用的一行标题。
 *
 * 真机数据里 `update.title` 可能就是一整条 PowerShell here-string（实测 15000 字，
 * 而且那条消息**没有** rawInput —— 完整命令只存在于 title 里）。所以这里只负责「取一行给抬头」，
 * 被裁掉的部分由调用方原样折进折叠块，一个字都不许丢。
 */
const headline = (value: string): { text: string; truncated: boolean } => {
  const firstLine = value.split('\n').find((line) => line.trim()) ?? '';
  const collapsed = firstLine.trim().replace(/\s+/g, ' ');
  const truncated = collapsed.length > TITLE_HEAD_CHARS || collapsed.length < value.trim().length;
  return { text: truncated ? `${collapsed.slice(0, TITLE_HEAD_CHARS)}…` : collapsed, truncated };
};

const details = (summary: string, body: string, open = false): string =>
  `<details class="tx-details"${open ? ' open' : ''}><summary>${summary}</summary><div class="tx-details-body">${body}</div></details>`;

const codeBlock = (text: string): string => `<pre class="tx-code"><code>${escapeHtml(text)}</code></pre>`;

const jsonBlock = (value: unknown): string => {
  try {
    return codeBlock(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } catch {
    return codeBlock(String(value));
  }
};

type DiffRow = { kind: 'ctx' | 'add' | 'del'; text: string };

/**
 * 行级 LCS diff。超预算返回 null，由调用方退化成「变更前 / 变更后」两块 ——
 * 宁可少画，也不要为了好看编一个假的对齐结果。
 */
export const diffLines = (before: string, after: string): DiffRow[] | null => {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > DIFF_LINE_BUDGET || b.length > DIFF_LINE_BUDGET) return null;

  const table: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      rows.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < a.length) rows.push({ kind: 'del', text: a[i++] });
  while (j < b.length) rows.push({ kind: 'add', text: b[j++] });
  return rows;
};

const DIFF_PREFIX: Record<DiffRow['kind'], string> = { ctx: ' ', add: '+', del: '-' };

const renderDiffRows = (rows: DiffRow[]): string =>
  `<div class="tx-diff">${rows
    .map((row) => `<div class="tx-diff-row tx-diff-${row.kind}">${escapeHtml(DIFF_PREFIX[row.kind] + row.text)}</div>`)
    .join('')}</div>`;

/** 已经是 unified diff 文本时，直接按行首字符上色，不再二次解析。 */
const renderRawDiff = (diffText: string): string =>
  `<div class="tx-diff">${diffText
    .split('\n')
    .map((line) => {
      const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
      return `<div class="tx-diff-row tx-diff-${kind}">${escapeHtml(line)}</div>`;
    })
    .join('')}</div>`;

const renderPathDiff = (path: string | undefined, before: string, after: string, ctx: MessageRenderContext): string => {
  const head = path ? `<div class="tx-path">${escapeHtml(path)}</div>` : '';
  const rows = diffLines(before, after);
  if (rows) return `${head}${renderDiffRows(rows)}`;
  return `${head}${details(escapeHtml(ctx.labels.diffBefore), codeBlock(before))}${details(
    escapeHtml(ctx.labels.diffAfter),
    codeBlock(after)
  )}`;
};

const renderImage = (src: string, ctx: MessageRenderContext): string => {
  const inlined = ctx.markdown.images[src];
  if (inlined) {
    return `<img class="tx-img" loading="lazy" src="${escapeAttr(inlined)}" alt="${escapeAttr(src)}" title="${escapeAttr(src)}">`;
  }
  return `<div class="tx-path">${escapeHtml(ctx.labels.imageMissing)} ${escapeHtml(src)}</div>`;
};

// ---------------------------------------------------------------------------
// 按消息类型渲染正文
// ---------------------------------------------------------------------------

/**
 * 超长正文折叠：摘要给出前 90 字与总字数，展开即完整内容。
 *
 * 文本消息与工具返回的长文本共用这一条规则 —— 真机数据里一次文件读取就能撑出 15000 像素高的
 * 代码块，把整列淹掉。折叠只是默认收起，内容一个字都没少。
 */
const foldIfLong = (raw: string, rendered: string, ctx: MessageRenderContext): string => {
  if (raw.length <= LONG_BODY_CHARS) return rendered;
  const preview = raw.slice(0, 90).replace(/\s+/g, ' ').trim();
  const summary = `${escapeHtml(preview)}… <span class="tx-tool-kind">${escapeHtml(
    fillLabel(ctx.labels.longBody, { chars: raw.length })
  )}</span>`;
  return details(summary, rendered);
};

const renderTextBody = (message: Extract<TMessage, { type: 'text' }>, ctx: MessageRenderContext): string => {
  const content = message.content?.content ?? '';
  const cron = message.content?.cronMeta;
  const cronChip = cron ? `<div class="tx-chip">⏱ ${escapeHtml(cron.cron_job_name || cron.cron_job_id)}</div>` : '';
  return `${cronChip}${foldIfLong(content, renderMarkdown(content, ctx.markdown), ctx)}`;
};

const renderThinkingBody = (message: Extract<TMessage, { type: 'thinking' }>, ctx: MessageRenderContext): string => {
  const { content = '', subject, duration } = message.content ?? {};
  const seconds = typeof duration === 'number' && duration > 0 ? Math.round(duration / 1000) : undefined;
  const summaryText =
    subject?.trim() ||
    (seconds !== undefined ? fillLabel(ctx.labels.thinkingSeconds, { seconds }) : ctx.labels.thinking);
  return details(
    `<span class="tx-summary-icon">✷</span>${escapeHtml(summaryText)}`,
    renderMarkdown(content, ctx.markdown)
  );
};

const renderToolCallBody = (message: Extract<TMessage, { type: 'tool_call' }>, ctx: MessageRenderContext): string => {
  const { name, args, input, output, error, status, description } = message.content ?? {};
  const tone = error ? 'failed' : toneOf(status);
  const parts: string[] = [
    `<div class="tx-tool-head">${badge(tone, ctx.labels)}<span class="tx-tool-name">${escapeHtml(name ?? ctx.labels.toolCall)}</span></div>`,
  ];
  if (description) {
    const desc = headline(description);
    parts.push(`<div class="tx-tool-desc">${escapeHtml(desc.text)}</div>`);
    if (desc.truncated) parts.push(details(escapeHtml(ctx.labels.fullText), codeBlock(description)));
  }
  const payload = input ?? args;
  if (payload !== undefined) parts.push(details(escapeHtml(ctx.labels.toolInput), jsonBlock(payload)));
  if (output) parts.push(details(escapeHtml(ctx.labels.toolOutput), codeBlock(output)));
  if (error) parts.push(`<div class="tx-error">${renderPlainText(error)}</div>`);
  return parts.join('');
};

const renderToolGroupBody = (message: Extract<TMessage, { type: 'tool_group' }>, ctx: MessageRenderContext): string =>
  (message.content ?? [])
    .map((item) => {
      const tone = toneOf(item?.status);
      const rawTitle = item?.description?.trim() || item?.name || ctx.labels.toolCall;
      const title = headline(rawTitle);
      const parts: string[] = [
        `<div class="tx-tool-head">${badge(tone, ctx.labels)}<span class="tx-tool-name">${escapeHtml(title.text)}</span></div>`,
      ];
      if (title.truncated) parts.push(details(escapeHtml(ctx.labels.fullText), codeBlock(rawTitle)));
      const display = item?.result_display;
      if (typeof display === 'string' && display) {
        parts.push(
          item?.render_output_as_markdown === false ? codeBlock(display) : renderMarkdown(display, ctx.markdown)
        );
      } else if (display && typeof display === 'object') {
        if ('file_diff' in display) {
          parts.push(`<div class="tx-path">${escapeHtml(display.file_name)}</div>${renderRawDiff(display.file_diff)}`);
        } else if ('img_url' in display) {
          parts.push(renderImage(display.img_url, ctx));
        }
      }
      const confirmation = item?.confirmationDetails;
      if (confirmation) {
        const detailText =
          confirmation.type === 'exec'
            ? confirmation.command
            : confirmation.type === 'edit'
              ? confirmation.file_name
              : confirmation.type === 'mcp'
                ? `${confirmation.server_name} · ${confirmation.tool_display_name}`
                : confirmation.prompt;
        parts.push(`<div class="tx-tool-desc">${escapeHtml(confirmation.title)} — ${escapeHtml(detailText)}</div>`);
      }
      return `<div class="tx-tool-item">${parts.join('')}</div>`;
    })
    .join('');

const renderAcpToolCallBody = (
  message: Extract<TMessage, { type: 'acp_tool_call' }>,
  ctx: MessageRenderContext
): string => {
  const update = message.content?.update;
  if (!update) return '';
  const tone = toneOf(update.status);
  const rawTitle = update.title || ctx.labels.toolCall;
  const title = headline(rawTitle);
  const parts: string[] = [
    [
      '<div class="tx-tool-head">',
      badge(tone, ctx.labels),
      `<span class="tx-tool-name">${escapeHtml(title.text)}</span>`,
      update.kind ? `<span class="tx-tool-kind">${escapeHtml(update.kind)}</span>` : '',
      '</div>',
    ].join(''),
  ];
  // 抬头只留一行，原文一字不改地折进来（有些 agent 把整条命令塞进 title 且不带 rawInput）。
  if (title.truncated) parts.push(details(escapeHtml(ctx.labels.fullText), codeBlock(rawTitle)));

  for (const item of update.content ?? []) {
    if (item?.type === 'diff') {
      parts.push(
        details(
          escapeHtml(ctx.labels.diff),
          renderPathDiff(item.path, item.old_text ?? '', item.new_text ?? '', ctx),
          true
        )
      );
    } else if (item?.content?.text) {
      const text = item.content.text;
      parts.push(foldIfLong(text, renderMarkdown(text, ctx.markdown), ctx));
    }
  }

  const locations = (update.locations ?? []).map((location) => location?.path).filter(Boolean);
  if (locations.length > 0) {
    parts.push(
      details(
        escapeHtml(ctx.labels.toolLocations),
        `<div class="tx-path-list">${locations.map((path) => `<div class="tx-path">${escapeHtml(String(path))}</div>`).join('')}</div>`
      )
    );
  }

  if (update.rawInput !== undefined) parts.push(details(escapeHtml(ctx.labels.toolInput), jsonBlock(update.rawInput)));
  const rawOutput = update.rawOutput ?? update.raw_output;
  if (rawOutput !== undefined) parts.push(details(escapeHtml(ctx.labels.toolOutput), jsonBlock(rawOutput)));

  return parts.join('');
};

const PLAN_MARK: Record<string, string> = { completed: '☑', in_progress: '◐', pending: '☐' };

const renderPlanBody = (message: Extract<TMessage, { type: 'plan' }>, ctx: MessageRenderContext): string => {
  const entries = message.content?.entries ?? [];
  const rows = entries
    .map(
      (entry) =>
        `<div class="tx-plan-row tx-plan-${escapeAttr(entry.status)}"><span class="tx-plan-mark">${
          PLAN_MARK[entry.status] ?? '☐'
        }</span><span>${escapeHtml(entry.content)}</span></div>`
    )
    .join('');
  return `<div class="tx-plan"><div class="tx-plan-title">${escapeHtml(ctx.labels.plan)}</div>${rows}</div>`;
};

const renderTipsBody = (message: Extract<TMessage, { type: 'tips' }>, ctx: MessageRenderContext): string => {
  const { content = '', type = 'info', error } = message.content ?? {};
  const detail = error?.message ? details(escapeHtml(ctx.labels.toolOutput), jsonBlock(error)) : '';
  return `<div class="tx-tip tx-tip-${escapeAttr(type)}">${renderPlainText(content)}</div>${detail}`;
};

const renderAgentStatusBody = (message: Extract<TMessage, { type: 'agent_status' }>): string => {
  const { backend, status, agent_name } = message.content ?? {};
  const who = agent_name?.trim() || backend || '';
  return `<div class="tx-system">${escapeHtml(`${who} · ${status ?? ''}`.trim())}</div>`;
};

const renderPermissionBody = (
  message: Extract<TMessage, { type: 'permission' | 'acp_permission' }>,
  ctx: MessageRenderContext
): string => {
  const content = message.content as {
    title?: string;
    description?: string;
    options?: Array<{ label?: string; name?: string; optionId?: string }>;
    toolCall?: { title?: string };
  };
  const title = content?.title?.trim() || content?.toolCall?.title?.trim() || ctx.labels.permissionRequest;
  const description = content?.description
    ? `<div class="tx-tool-desc">${renderPlainText(content.description)}</div>`
    : '';
  const options = (content?.options ?? [])
    .map((option) => option?.label || option?.name || option?.optionId)
    .filter(Boolean)
    .map((label) => `<span class="tx-chip">${escapeHtml(String(label))}</span>`)
    .join('');
  const optionRow = options
    ? `<div class="tx-chip-row">${escapeHtml(ctx.labels.permissionOptions)}${options}</div>`
    : '';
  return `<div class="tx-tool-head"><span class="tx-tool-name">${escapeHtml(title)}</span></div>${description}${optionRow}`;
};

const renderBody = (message: TMessage, ctx: MessageRenderContext): string => {
  switch (message.type) {
    case 'text':
      return renderTextBody(message, ctx);
    case 'thinking':
      return renderThinkingBody(message, ctx);
    case 'tool_call':
      return renderToolCallBody(message, ctx);
    case 'tool_group':
      return renderToolGroupBody(message, ctx);
    case 'acp_tool_call':
      return renderAcpToolCallBody(message, ctx);
    case 'plan':
      return renderPlanBody(message, ctx);
    case 'tips':
      return renderTipsBody(message, ctx);
    case 'agent_status':
      return renderAgentStatusBody(message);
    case 'permission':
    case 'acp_permission':
      return renderPermissionBody(message, ctx);
    default:
      return `<div class="tx-system">${escapeHtml(
        fillLabel(ctx.labels.unknownType, { type: (message as { type: string }).type })
      )}</div>`;
  }
};

/** 抬头里「谁在说话」。用户消息是 position=right，队友转发的消息带 senderName。 */
const renderWho = (message: TMessage, member: TranscriptMember, ctx: MessageRenderContext): string => {
  if (message.position === 'right') {
    return `<span class="tx-who tx-who-user">${escapeHtml(ctx.labels.you)}</span>`;
  }
  const senderName =
    message.type === 'text' && message.content?.teammateMessage ? message.content.senderName?.trim() : undefined;
  const own = `<span class="tx-who" style="color:${escapeAttr(member.color)}">${escapeHtml(member.name)}</span>`;
  if (!senderName) return own;
  return `${own}<span class="tx-from">${escapeHtml(fillLabel(ctx.labels.fromTeammate, { name: senderName }))}</span>`;
};

/**
 * 一条消息 → 一个 `<article>`。
 *
 * `data-member` / `data-idx` 供产物内的 JS 做「列视图 ↔ 时间线」切换与筛选；
 * 两种视图共用同一批节点（不复制内容），否则大团队的产物体积会直接翻倍。
 */
export const renderTranscriptMessage = (
  entry: TranscriptEntry,
  index: number,
  member: TranscriptMember,
  ctx: MessageRenderContext
): string => {
  const time = entry.createdAt ? formatDisplayTime(entry.createdAt) : '';
  const timeCell = time ? `<time class="tx-time">${escapeHtml(time)}</time>` : '';
  return [
    `<article class="tx-msg tx-kind-${escapeAttr(entry.message.type)}" id="m-${escapeAttr(entry.id)}"`,
    ` data-member="${escapeAttr(member.slot_id)}" data-idx="${index}"`,
    ` data-pos="${escapeAttr(entry.message.position ?? 'left')}" style="--c:${escapeAttr(member.color)}">`,
    `<header class="tx-msg-head">${renderWho(entry.message, member, ctx)}${timeCell}</header>`,
    `<div class="tx-msg-body">${renderBody(entry.message, ctx)}</div>`,
    '</article>',
  ].join('');
};
