import type { TMessage } from '@/common/chat/chatLib';
import type { TChatConversation } from '@/common/config/storage';

const INVALID_FILENAME_CHARS_RE = /[<>:"/\\|?*]/g;
const padTimestampPart = (value: number): string => String(value).padStart(2, '0');

export const sanitizeFileName = (name: string): string => {
  const cleaned = name.replace(INVALID_FILENAME_CHARS_RE, '_').trim();
  return (cleaned || 'conversation').slice(0, 80);
};

const normalizeDefaultExportSegment = (name: string): string => {
  const normalized = sanitizeFileName(name)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'conversation';
};

const getShortConversationId = (conversation_id?: string): string => {
  const normalized = (conversation_id || '').trim();
  return normalized.slice(0, 8) || 'conversation';
};

export const joinFilePath = (dir: string, file_name: string): string => {
  const separator = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${file_name}` : `${dir}${separator}${file_name}`;
};

export const formatTimestamp = (time = Date.now()): string => {
  const date = new Date(time);
  return `${date.getFullYear()}${padTimestampPart(date.getMonth() + 1)}${padTimestampPart(date.getDate())}-${padTimestampPart(date.getHours())}${padTimestampPart(date.getMinutes())}${padTimestampPart(date.getSeconds())}`;
};

const formatDefaultExportFileDate = (time = Date.now()): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())}`;
};

export const readMessageContent = (message: TMessage): string => {
  const content = message.content as Record<string, unknown> | string | undefined;

  if (typeof content === 'string') {
    return content;
  }

  if (content && typeof content === 'object' && typeof content.content === 'string') {
    return content.content;
  }

  try {
    return JSON.stringify(content ?? {}, null, 2);
  } catch {
    return String(content ?? '');
  }
};

export type MessageRole = 'user' | 'assistant' | 'system';

export type ExportTranscriptLabels = {
  conversation: string;
  conversation_id: string;
  exportedAt: string;
  type: string;
  noMessages: string;
} & Record<MessageRole, string>;

export const getMessageRoleKey = (message: TMessage): MessageRole => {
  if (message.position === 'right') return 'user';
  if (message.position === 'left') return 'assistant';
  return 'system';
};

const isShareableMessage = (message: TMessage): boolean => {
  return message.type === 'text' || message.type === 'tips';
};

const isUserTextMessage = (message: TMessage): boolean => {
  return message.type === 'text' && message.position === 'right';
};

export const buildConversationExportText = (
  conversation: TChatConversation,
  messages: TMessage[],
  labels: ExportTranscriptLabels
): string => {
  const lines: string[] = [];
  lines.push(`${labels.conversation}: ${conversation.name || labels.conversation}`);
  lines.push(`${labels.conversation_id}: ${conversation.id}`);
  lines.push(`${labels.exportedAt}: ${new Date().toISOString()}`);
  lines.push(`${labels.type}: ${conversation.type}`);
  lines.push('');

  const exportableMessages = messages.filter(isShareableMessage);
  exportableMessages.forEach((message) => {
    lines.push(`${labels[getMessageRoleKey(message)]}:`);
    lines.push(readMessageContent(message));
    lines.push('');
  });

  if (exportableMessages.length === 0) {
    lines.push(labels.noMessages);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

export const buildDefaultExportFileName = (conversation_id: string, conversationName: string): string => {
  const safeName = normalizeDefaultExportSegment(conversationName).slice(0, 48).replace(/-+$/g, '') || 'conversation';
  return `${formatDefaultExportFileDate()}-${getShortConversationId(conversation_id)}-${safeName}.txt`;
};

export const getDefaultExportFileNameSource = (conversation: TChatConversation, messages: TMessage[]): string => {
  const firstUserMessage = messages.find(isUserTextMessage);
  const firstUserMessageContent = firstUserMessage ? readMessageContent(firstUserMessage).trim() : '';

  return firstUserMessageContent || conversation.name || 'conversation';
};

export const normalizeExportFileName = (input: string): string => {
  const trimmed = input.trim();
  const withoutExtension = trimmed.replace(/\.txt$/i, '');
  return `${sanitizeFileName(withoutExtension || 'conversation')}.txt`;
};

export const resolveExportBaseDirectory = (workspace?: string, desktopPath?: string): string => {
  return workspace?.trim() || desktopPath?.trim() || '';
};

export type MarkdownTranscriptLabels = {
  untitled: string;
  exportedAt: string;
  messageCount: string;
  noMessages: string;
  answeredQuestions: string;
} & Record<MessageRole, string>;

const formatMarkdownTime = (time: number): string => {
  const date = new Date(time);
  return `${date.getFullYear()}-${padTimestampPart(date.getMonth() + 1)}-${padTimestampPart(date.getDate())} ${padTimestampPart(date.getHours())}:${padTimestampPart(date.getMinutes())}`;
};

const ASK_USER_TOOL_NAME = 'AskUserQuestion';
/** One answered question in dream-engine's AskUserQuestion tool result
 *  (`- <question>` then `  Answer: <labels>`; see ask_user_tool.rs format_answers). */
const ASK_ANSWER_PATTERN = /^- (.+)\n {2}Answer: (.+)$/gm;
const UNANSWERED_MARKER = '(no answer';

/** The user's answers recorded in an AskUserQuestion tool result, in order. */
export const parseAskUserAnswers = (output: string): Array<{ question: string; answer: string }> =>
  Array.from(output.matchAll(ASK_ANSWER_PATTERN))
    .map((match) => ({ question: match[1].trim(), answer: match[2].trim() }))
    .filter((entry) => entry.answer && !entry.answer.startsWith(UNANSWERED_MARKER));

/** Markdown body for the answers the user gave in the question dialog, or '' if none. */
const readAskAnswers = (message: TMessage): string => {
  if (message.type !== 'tool_call') return '';
  const content = message.content as { name?: string; output?: unknown };
  if (content.name !== ASK_USER_TOOL_NAME || typeof content.output !== 'string') return '';
  return parseAskUserAnswers(content.output)
    .map(({ question, answer }) => `**${question}**\n${answer}`)
    .join('\n\n');
};

const readTranscriptBody = (message: TMessage): string =>
  message.type === 'text' ? readMessageContent(message).trim() : readAskAnswers(message);

const isTranscriptMessage = (message: TMessage): boolean => !message.hidden && readTranscriptBody(message).length > 0;

/** Speaker of a transcript block: teammates keep their own name. */
const getSpeakerLabel = (message: TMessage, labels: MarkdownTranscriptLabels): string => {
  if (message.type === 'tool_call') return `${labels.user} · ${labels.answeredQuestions}`;
  const senderName = message.type === 'text' ? message.content.senderName : undefined;
  return senderName?.trim() || labels[getMessageRoleKey(message)];
};

/**
 * Render a conversation as a readable Markdown chat record.
 *
 * Only the user/assistant text is kept — tool calls, thinking and status tips
 * are working noise, not the conversation — plus the answers the user gave in
 * the question dialog, which are part of the conversation even though they
 * travel as a tool result. Consecutive pieces from the same
 * speaker (an answer split around tool calls) are merged under one heading.
 * Assistant text is already Markdown, so it is written as-is, not fenced.
 */
export const buildConversationMarkdownTranscript = (
  conversation: TChatConversation,
  messages: TMessage[],
  labels: MarkdownTranscriptLabels,
  exportedAt = Date.now()
): string => {
  const transcript = messages.filter(isTranscriptMessage);
  const lines: string[] = [];
  lines.push(`# ${conversation.name?.trim() || labels.untitled}`);
  lines.push('');
  lines.push(
    `> ${labels.exportedAt}: ${formatMarkdownTime(exportedAt)} · ${labels.messageCount}: ${transcript.length}`
  );
  lines.push('');

  if (transcript.length === 0) {
    lines.push(labels.noMessages);
    lines.push('');
    return lines.join('\n');
  }

  let previousSpeaker: string | null = null;
  transcript.forEach((message) => {
    const speaker = getSpeakerLabel(message, labels);
    const body = readTranscriptBody(message);
    if (speaker === previousSpeaker) {
      lines.push(body);
      lines.push('');
      return;
    }
    previousSpeaker = speaker;
    lines.push('---');
    lines.push('');
    const time = message.created_at;
    lines.push(time ? `## ${speaker} · ${formatMarkdownTime(time)}` : `## ${speaker}`);
    lines.push('');
    lines.push(body);
    lines.push('');
  });

  return lines.join('\n');
};

/** `2026-10-08-<conversation name>.md`, safe on every desktop file system. */
export const buildMarkdownExportFileName = (conversation: TChatConversation, time = Date.now()): string => {
  const name =
    sanitizeFileName(conversation.name || 'conversation')
      .slice(0, 60)
      .trim() || 'conversation';
  return `${formatDefaultExportFileDate(time)}-${name}.md`;
};

/** Labels for {@link buildConversationMarkdownTranscript} from the active locale. */
export const buildMarkdownTranscriptLabels = (t: (key: string) => string): MarkdownTranscriptLabels => ({
  untitled: t('messages.export.untitled'),
  exportedAt: t('messages.export.exportedAtLabel'),
  messageCount: t('messages.export.messageCountLabel'),
  noMessages: t('messages.export.noMessages'),
  answeredQuestions: t('messages.export.answeredQuestionsLabel'),
  user: t('messages.export.userLabel'),
  assistant: t('messages.export.assistantLabel'),
  system: t('messages.export.systemLabel'),
});
