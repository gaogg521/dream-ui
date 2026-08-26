/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { parseError } from '@/common/utils';
import { Message } from '@arco-design/web-react';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { emitter } from '@/renderer/utils/emitter';
import type { TFunction } from 'i18next';

/**
 * Map a fork API failure to a user-facing message. The backend carries stable
 * `FORK_*` reason prefixes (409/422); anything else falls back to the raw
 * parsed message.
 */
export function getForkErrorMessage(error: unknown, t: TFunction): string {
  const raw = parseError(error);
  if (raw.includes('FORK_TURN_IN_FLIGHT')) return t('messages.fork.errorTurnInFlight');
  if (raw.includes('FORK_PARENT_UNBOUND')) return t('messages.fork.errorParentUnbound');
  if (raw.includes('FORK_POINT_UNSUPPORTED')) return t('messages.fork.errorPointUnsupported');
  if (raw.includes('FORK_UNSUPPORTED')) return t('messages.fork.errorUnsupported');
  return t('messages.fork.errorGeneric', { message: raw });
}

/**
 * Fork the current conversation at a message: call the fork API, jump into the
 * forked conversation, and pre-warm its runtime so a backend-side fork failure
 * surfaces immediately instead of on the first send.
 */
export function useForkConversation(conversationId: string | undefined) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const forkingRef = useRef(false);

  return useCallback(
    async (messageId: string) => {
      if (!conversationId || forkingRef.current) return;
      forkingRef.current = true;
      try {
        const forked = await ipcBridge.conversation.fork.invoke({
          conversation_id: conversationId,
          message_id: messageId,
        });
        if (!forked?.id) {
          throw new Error('fork returned no conversation');
        }
        emitter.emit('chat.history.refresh');
        void navigate(`/conversation/${forked.id}`);
        /*
         * Lazy fork + eager surfacing: materialize the backend session now so
         * "parent session gone" style failures show up before the first send.
         *
         * The failure must be shown. The backend treats a missing fork parent as a hard error
         * rather than degrading to an empty session, precisely so this call can report it — and
         * swallowing it here left the user with a conversation that looks complete (the visible
         * history was copied) but whose session can never start, with nothing on screen to say
         * why and no way to repair it: `extra.fork` stays put, so every open retries the same
         * failing path.
         *
         * It is reported as a warning rather than by unwinding: the fork itself succeeded and we
         * have already navigated into it, so this is a degraded-but-real conversation, not a
         * failed operation.
         */
        void ipcBridge.conversation.ensureRuntime
          .invoke({ conversation_id: forked.id })
          .catch((runtimeError: unknown): void => {
            console.error('Forked conversation runtime failed to materialize:', runtimeError);
            Message.warning(getForkErrorMessage(runtimeError, t));
          });
      } catch (error) {
        console.error('Failed to fork conversation:', error);
        Message.error(getForkErrorMessage(error, t));
      } finally {
        forkingRef.current = false;
      }
    },
    [conversationId, navigate, t]
  );
}
