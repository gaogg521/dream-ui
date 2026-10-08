/**
 * Copyright 2026 One Work
 */

import type { IAskQuestion, IMessageAsk } from '@/common/chat/chatLib';
import { Button, Card } from '@arco-design/web-react';
import { CheckOne, Help } from '@icon-park/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
// The permission panel's stylesheet supplies the shared card chrome; own.* adds
// the question-specific pieces, built on the same tokens so the two cards read
// as siblings.
import styles from './components/MessagePermission/PermissionRequestPanel.module.css';
import own from './MessageQuestion.module.css';
import { getAskSettlement, setAskMinimized, useAskStoreVersion } from './question/askSettlementStore';

type MessageQuestionProps = {
  message: IMessageAsk;
};

/**
 * Transcript record of a structured question (`ask` frame — AskUserQuestion).
 *
 * Answering happens in the QuestionDialog docked above the composer; this card
 * only shows what was asked and, once settled, what the user chose. Both read
 * the same settlement store so they never disagree.
 */
const MessageQuestion: React.FC<MessageQuestionProps> = React.memo(({ message }) => {
  const { t } = useTranslation();
  useAskStoreVersion();
  const content = message.content || ({} as IMessageAsk['content']);
  const questions = useMemo<IAskQuestion[]>(
    () => (Array.isArray(content.questions) ? content.questions : []),
    [content.questions]
  );
  const requestId = content.request_id || message.id;
  const settlement = getAskSettlement(requestId);

  if (!questions.length) return null;

  const answerFor = (question: IAskQuestion): string | undefined => {
    if (settlement?.status !== 'answered') return undefined;
    const labels = settlement.answers.find((answer) => answer.question === question.question)?.labels ?? [];
    return labels.length > 0 ? labels.join(t('messages.askAnswerSeparator')) : undefined;
  };

  return (
    <Card className={styles.card} bordered={false} data-testid='message-question'>
      <div className={styles.panel}>
        {questions.map((question, index) => (
          <div key={index} className={own.questionBlock} data-testid={`message-question-item-${index}`}>
            {question.header ? <div className={own.header}>{question.header}</div> : null}
            <div className={own.question}>{question.question}</div>
            {answerFor(question) ? (
              <div className={own.answer} data-testid={`message-question-answer-${index}`}>
                {answerFor(question)}
              </div>
            ) : null}
          </div>
        ))}
        {settlement ? (
          <div
            className={`${styles.feedback} ${settlement.status === 'expired' ? '' : styles.success}`}
            role='status'
            aria-live='polite'
            data-testid='message-question-status'
          >
            <CheckOne theme='outline' size='16' aria-hidden='true' />
            <span>
              {settlement.status === 'answered'
                ? t('messages.askAnswered')
                : settlement.status === 'declined'
                  ? t('messages.askDeclined')
                  : t('messages.askExpired')}
            </span>
          </div>
        ) : (
          <div className={own.pending} data-testid='message-question-pending'>
            <Help theme='outline' size='16' fill='rgb(var(--primary-6))' aria-hidden='true' />
            <span className={own.pendingText}>{t('messages.askPendingInline')}</span>
            <Button
              size='small'
              type='primary'
              onClick={() => setAskMinimized(requestId, false)}
              data-testid='message-question-open'
            >
              {t('messages.askReopen')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageQuestion;
