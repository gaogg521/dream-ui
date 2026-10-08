/**
 * Copyright 2026 One Work
 */

import type { TChatConversation } from '@/common/config/storage';
import { resolveConversationBackend } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { sanitizeFileName } from '@/renderer/utils/chat/conversationExport';

export const EXPORT_IO_TIMEOUT_MS = 15000;

/** Zip entry for one conversation's Markdown chat record; the id suffix keeps same-named topics apart. */
export const buildTranscriptEntryName = (conversation: TChatConversation): string => {
  const safeName = sanitizeFileName(conversation.name || conversation.id);
  return `${safeName}__${conversation.id.slice(0, 8)}.md`;
};

export const getBackendKeyFromConversation = (conversation: TChatConversation): string | undefined => {
  return resolveConversationBackend(conversation);
};

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timeout`));
      }, timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};
