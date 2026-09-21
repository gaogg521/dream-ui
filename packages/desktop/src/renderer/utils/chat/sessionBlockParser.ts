/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse the cross-session delivery blocks the backend mints at the send
 * boundary (`[[DREAM_SESSIONS]]`, outbound) and the drainer
 * (`[[DREAM_SESSION_MESSAGE]]`, inbound). Each block is the marker on its own
 * line followed by one compact JSON payload line.
 *
 * Strictness contract (defense in depth on top of the backend's zero-width
 * escaping of user-typed markers): the marker must occupy a whole line, the
 * remainder must be a single JSON object, and the payload must carry the
 * marker's required fields. Anything else is ordinary message text.
 */

export const SESSIONS_MARKER = '[[DREAM_SESSIONS]]';
export const SESSION_MESSAGE_MARKER = '[[DREAM_SESSION_MESSAGE]]';
/**
 * Personal-edition share block: a conversation snapshot forwarded into
 * another of the user's own conversations. Deliberately NOT a `[[DREAM_...]]`
 * marker — the backend escaper breaks that prefix inside user-sent text, and
 * this block travels through the ordinary send edge. Forgery renders a
 * cosmetic card in the forger's own conversation; nothing else consumes it.
 */
export const SESSION_SHARE_MARKER = '[[SESSION_SHARE]]';

export type SessionTarget = {
  id: string;
  title: string;
  workspace: string | null;
};

export type SessionsPayload = {
  targets: SessionTarget[];
  from_workspace: string | null;
  body: string;
  reply_requested: boolean;
};

export type SessionMessagePayload = {
  from_conversation_id: string;
  from_title: string;
  same_workspace: boolean;
  from_workspace: string | null;
  to_workspace: string | null;
  body: string;
  reply_requested: boolean;
  reply_to_conversation_id?: string;
};

export type SharedSnapshotMessage = {
  type: string;
  /** Raw JSON string of the original message content — parsed at render time. */
  content: string;
  position: string | null;
  createdAt: number | null;
};

export type SessionSharePayload = {
  name: string;
  shared_at: number | null;
  messages: SharedSnapshotMessage[];
};

export type ParsedSessionBlock =
  | { marker: typeof SESSIONS_MARKER; payload: SessionsPayload; head: string }
  | { marker: typeof SESSION_MESSAGE_MARKER; payload: SessionMessagePayload; head: string }
  | { marker: typeof SESSION_SHARE_MARKER; payload: SessionSharePayload; head: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSessionsPayload = (value: unknown): SessionsPayload | null => {
  if (!isRecord(value) || !Array.isArray(value.targets) || value.targets.length === 0) {
    return null;
  }
  const targets: SessionTarget[] = [];
  for (const target of value.targets) {
    if (!isRecord(target)) {
      return null;
    }
    const id = target.id;
    const title = target.title;
    const workspace = typeof target.workspace === 'string' ? target.workspace : null;
    if (typeof id !== 'string' || typeof title !== 'string') {
      return null;
    }
    targets.push({ id, title, workspace });
  }
  const body = value.body;
  const replyRequested = value.reply_requested;
  if (typeof body !== 'string' || typeof replyRequested !== 'boolean') {
    return null;
  }
  const fromWorkspace = typeof value.from_workspace === 'string' ? value.from_workspace : null;
  return {
    targets,
    from_workspace: fromWorkspace,
    body,
    reply_requested: replyRequested,
  };
};

const parseSessionMessagePayload = (value: unknown): SessionMessagePayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const fromConversationId = value.from_conversation_id;
  const fromTitle = value.from_title;
  const sameWorkspace = value.same_workspace;
  const body = value.body;
  const replyRequested = value.reply_requested;
  const replyToConversationId = value.reply_to_conversation_id;
  if (typeof fromConversationId !== 'string' || typeof fromTitle !== 'string') {
    return null;
  }
  if (typeof sameWorkspace !== 'boolean' || typeof body !== 'string' || typeof replyRequested !== 'boolean') {
    return null;
  }
  const fromWorkspace = typeof value.from_workspace === 'string' ? value.from_workspace : null;
  const toWorkspace = typeof value.to_workspace === 'string' ? value.to_workspace : null;
  const payload: SessionMessagePayload = {
    from_conversation_id: fromConversationId,
    from_title: fromTitle,
    same_workspace: sameWorkspace,
    from_workspace: fromWorkspace,
    to_workspace: toWorkspace,
    body,
    reply_requested: replyRequested,
  };
  if (typeof replyToConversationId === 'string') {
    payload.reply_to_conversation_id = replyToConversationId;
  }
  return payload;
};

/**
 * Extract a delivery block from message text. `head` is everything before the
 * marker (trimmed); empty for an inbound block, which starts at the marker.
 * Returns null when the text carries no valid block — callers must fall back
 * to rendering the text as-is.
 */
export const parseSessionDeliveryBlock = (content: string): ParsedSessionBlock | null => {
  if (
    !content.includes(SESSIONS_MARKER) &&
    !content.includes(SESSION_MESSAGE_MARKER) &&
    !content.includes(SESSION_SHARE_MARKER)
  ) {
    return null;
  }
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const marker =
      line === SESSION_MESSAGE_MARKER
        ? SESSION_MESSAGE_MARKER
        : line === SESSIONS_MARKER
          ? SESSIONS_MARKER
          : line === SESSION_SHARE_MARKER
            ? SESSION_SHARE_MARKER
            : null;
    if (!marker) {
      continue;
    }
    // The backend writes the payload on the next line, compact. Anything that
    // fails JSON.parse here is not a server-minted block.
    const payloadText = lines
      .slice(index + 1)
      .join('\n')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      continue;
    }
    const head = lines.slice(0, index).join('\n').trimEnd();
    if (marker === SESSION_MESSAGE_MARKER) {
      const payload = parseSessionMessagePayload(parsed);
      if (payload) return { marker, payload, head };
    } else if (marker === SESSION_SHARE_MARKER) {
      const payload = parseSessionSharePayload(parsed);
      if (payload) return { marker, payload, head };
    } else {
      const payload = parseSessionsPayload(parsed);
      if (payload) return { marker, payload, head };
    }
  }
  return null;
};

const parseSessionSharePayload = (value: unknown): SessionSharePayload | null => {
  if (!isRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.messages)) {
    return null;
  }
  const messages: SharedSnapshotMessage[] = [];
  for (const message of value.messages) {
    if (!isRecord(message) || typeof message.type !== 'string' || typeof message.content !== 'string') {
      return null;
    }
    const position = typeof message.position === 'string' ? message.position : null;
    const createdAt = typeof message.createdAt === 'number' ? message.createdAt : null;
    messages.push({ type: message.type, content: message.content, position, createdAt });
  }
  const sharedAt = typeof value.sharedAt === 'number' ? value.sharedAt : null;
  return { name: value.name, shared_at: sharedAt, messages };
};
