/**
 * Copyright 2026 One Work
 */

import { conversation } from '@/common/adapter/ipcBridge';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { settleAsk, type AskAnswer } from './askSettlementStore';

export type AskSubmitResult = 'ok' | 'expired' | 'failed';

/**
 * Send the user's answers (or an explicit decline) for one question card.
 *
 * A 4xx means the backend is no longer waiting for this question — the turn
 * was stopped or another window answered — so the card is retired as expired.
 * Anything else (timeout, 5xx) leaves it open so the user can retry.
 */
export async function submitAsk(
  conversationId: string,
  requestId: string,
  payload: { answers: AskAnswer[] } | { decline: true }
): Promise<AskSubmitResult> {
  try {
    await conversation.answerAsk.invoke({ conversation_id: conversationId, request_id: requestId, ...payload });
    settleAsk(
      requestId,
      'answers' in payload ? { status: 'answered', answers: payload.answers } : { status: 'declined' }
    );
    return 'ok';
  } catch (error) {
    if (isBackendHttpError(error) && error.status >= 400 && error.status < 500) {
      settleAsk(requestId, { status: 'expired' });
      return 'expired';
    }
    console.error('[submitAsk] failed to deliver the answer:', error);
    return 'failed';
  }
}
