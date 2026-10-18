/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';

export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  try {
    return await ipcBridge.conversation.get.invoke({ id: conversation_id });
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

const RECONCILE_RETRY_DELAYS_MS = [1000, 3000];

/**
 * {@link getConversationOrNull}, retried after a short wait when it fails.
 *
 * Used by the realtime-reconnect reconcile, which runs once per reconnect: a
 * reconnect follows a stretch where the window was too busy to read its socket,
 * and the first request after it can fail for the same transient reason. Giving
 * up there leaves the turn shown as "processing" until the next reload.
 */
export async function getConversationOrNullWithRetry(
  conversation_id: string,
  delaysMs: readonly number[] = RECONCILE_RETRY_DELAYS_MS
): Promise<TChatConversation | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getConversationOrNull(conversation_id);
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await getConversationOrNull(conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
