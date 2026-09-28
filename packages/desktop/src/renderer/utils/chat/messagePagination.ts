/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import type { MessageCursorPage } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';

export type MessageContentMode = 'compact' | 'full';

export type LoadConversationMessagePageOptions = {
  limit?: number;
  before?: string;
  after?: string;
  anchorMessageId?: string;
  contentMode?: MessageContentMode;
};

export const DEFAULT_MESSAGE_PAGE_LIMIT = 50;
export const MAX_MESSAGE_PAGE_LIMIT = 200;

export async function loadConversationMessagePage(
  conversationId: string,
  options: LoadConversationMessagePageOptions = {}
): Promise<MessageCursorPage<TMessage>> {
  return ipcBridge.database.getConversationMessages.invoke({
    conversation_id: conversationId,
    limit: options.limit ?? DEFAULT_MESSAGE_PAGE_LIMIT,
    ...(options.before ? { before: options.before } : {}),
    ...(options.after ? { after: options.after } : {}),
    ...(options.anchorMessageId ? { anchor_message_id: options.anchorMessageId } : {}),
    content_mode: options.contentMode ?? 'compact',
  });
}

export function loadLatestConversationMessages(
  conversationId: string,
  options: Pick<LoadConversationMessagePageOptions, 'limit' | 'contentMode'> = {}
): Promise<MessageCursorPage<TMessage>> {
  return loadConversationMessagePage(conversationId, options);
}

export function loadConversationAnchorWindow(
  conversationId: string,
  messageId: string,
  options: Pick<LoadConversationMessagePageOptions, 'limit' | 'contentMode'> = {}
): Promise<MessageCursorPage<TMessage>> {
  return loadConversationMessagePage(conversationId, {
    ...options,
    anchorMessageId: messageId,
  });
}

/**
 * Read every persisted message that landed after a known cursor.
 *
 * Live WebSocket frames make an active conversation feel immediate, but a phone
 * can miss an arbitrary number of frames while it is backgrounded or switching
 * networks. Cursor pagination is the durable recovery path: keep advancing the
 * `after` cursor until the backend confirms that there is no newer page.
 */
export async function loadNewerConversationMessagesPaged(
  conversationId: string,
  after: string,
  options: Pick<LoadConversationMessagePageOptions, 'limit' | 'contentMode'> = {}
): Promise<MessageCursorPage<TMessage>> {
  const limit = options.limit ?? DEFAULT_MESSAGE_PAGE_LIMIT;
  const contentMode = options.contentMode ?? 'compact';
  const items: TMessage[] = [];
  let cursor = after;
  let newestCursor: string | null = after;
  let hasMoreAfter = false;

  do {
    const page = await loadConversationMessagePage(conversationId, {
      limit,
      after: cursor,
      contentMode,
    });
    items.push(...page.items);
    newestCursor = page.newest_cursor ?? newestCursor;
    hasMoreAfter = page.has_more_after;

    // A malformed or stale response must not create an infinite reconnect loop.
    if (!hasMoreAfter || !page.newest_cursor || page.newest_cursor === cursor) {
      break;
    }
    cursor = page.newest_cursor;
  } while (hasMoreAfter);

  return {
    items,
    oldest_cursor: after,
    newest_cursor: newestCursor,
    has_more_before: false,
    has_more_after: hasMoreAfter,
  };
}

export async function loadAllConversationMessagesPaged(
  conversationId: string,
  options: Pick<LoadConversationMessagePageOptions, 'limit' | 'contentMode'> = {}
): Promise<TMessage[]> {
  const limit = options.limit ?? MAX_MESSAGE_PAGE_LIMIT;
  const contentMode = options.contentMode ?? 'full';
  const latest = await loadConversationMessagePage(conversationId, { limit, contentMode });
  const pages: TMessage[][] = [latest.items];
  let before = latest.oldest_cursor ?? undefined;
  let hasMoreBefore = latest.has_more_before;

  while (hasMoreBefore && before) {
    const page = await loadConversationMessagePage(conversationId, {
      limit,
      before,
      contentMode,
    });
    pages.unshift(page.items);
    before = page.oldest_cursor ?? undefined;
    hasMoreBefore = page.has_more_before;
  }

  return pages.flat();
}
