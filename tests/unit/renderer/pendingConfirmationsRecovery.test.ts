import type { IConfirmation, TMessage } from '@/common/chat/chatLib';
import { describe, expect, it } from 'vitest';
import {
  buildPendingConfirmationMessage,
  hasPermissionMessageForCallId,
  removePermissionMessage,
} from '@/renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';
import {
  resetAskStoreForTests,
  setAskSubmitting,
  settleAsk,
} from '@/renderer/pages/conversation/Messages/question/askSettlementStore';

const confirmation: IConfirmation<string> = {
  id: 'tool-1',
  call_id: 'tool-1',
  title: 'Write file',
  description: 'Write /tmp/current_time.txt',
  command_type: 'edit',
  options: [{ label: 'Allow', value: 'allow_once' }],
};

describe('pending confirmations recovery', () => {
  it('builds a permission message with stable msg_id from confirmation id', () => {
    const message = buildPendingConfirmationMessage('conv-1', confirmation);

    expect(message.type).toBe('permission');
    expect(message.conversation_id).toBe('conv-1');
    expect(message.msg_id).toBe('confirmation:tool-1');
    expect(message.content.call_id).toBe('tool-1');
  });

  it('detects existing permission messages by call_id', () => {
    const list = [buildPendingConfirmationMessage('conv-1', confirmation)];

    expect(hasPermissionMessageForCallId(list, 'tool-1')).toBe(true);
    expect(hasPermissionMessageForCallId(list, 'tool-2')).toBe(false);
  });

  it('removes recovered permission messages by confirmation id or call_id', () => {
    const list = [
      buildPendingConfirmationMessage('conv-1', confirmation),
      { id: 'text-1', type: 'text', conversation_id: 'conv-1', content: { content: 'hello' } },
    ] as TMessage[];

    const result = removePermissionMessage(list, { id: 'tool-1', call_id: 'tool-1' });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });
  it('drops a pending question card but keeps one this window already answered', () => {
    resetAskStoreForTests();
    const askCard = (requestId: string) =>
      ({
        id: `ask-${requestId}`,
        type: 'ask',
        conversation_id: 'conv-1',
        content: { session_id: 'conv-1', request_id: requestId, questions: [] },
      }) as TMessage;
    settleAsk('answered-here', { status: 'answered', answers: [] });

    const list = [askCard('answered-here'), askCard('answered-elsewhere')];
    const afterFirst = removePermissionMessage(list, { id: 'answered-here', call_id: 'answered-here' });
    const afterSecond = removePermissionMessage(afterFirst, {
      id: 'answered-elsewhere',
      call_id: 'answered-elsewhere',
    });

    // The answered card is the transcript record of the user's choice.
    expect(afterSecond.map((message) => message.id)).toEqual(['ask-answered-here']);
  });
  it('keeps a card whose answer is still in flight (removal is broadcast before the reply)', () => {
    resetAskStoreForTests();
    const card = {
      id: 'ask-inflight',
      type: 'ask',
      conversation_id: 'conv-1',
      content: { session_id: 'conv-1', request_id: 'inflight', questions: [] },
    } as TMessage;
    setAskSubmitting('inflight', true);

    expect(removePermissionMessage([card], { id: 'inflight', call_id: 'inflight' })).toHaveLength(1);
  });
});
