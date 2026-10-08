/**
 * Copyright 2026 One Work
 */

import type { IAskQuestion, IMessageAsk, TMessage } from '@/common/chat/chatLib';
import { useMessageList } from '@renderer/pages/conversation/Messages/hooks';
import { Button, Checkbox, Input, Message, Radio, Tooltip } from '@arco-design/web-react';
import { Close, Down, Help } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import own from '../MessageQuestion.module.css';
import {
  getAskSettlement,
  isAskMinimized,
  setAskMinimized,
  useAskStoreVersion,
  type AskAnswer,
} from './askSettlementStore';
import styles from './QuestionDialog.module.css';
import { submitAsk } from './submitAsk';

const OTHER_VALUE = '__one_other__';
/** Pause before auto-advancing, so the user sees which option they picked. */
const AUTO_ADVANCE_MS = 180;

type Draft = { labels: string[]; other: string; otherSelected: boolean };

const emptyDraft = (): Draft => ({ labels: [], other: '', otherSelected: false });

const isMultiSelect = (question: IAskQuestion): boolean =>
  question.multiSelect === true || question.multi_select === true;

const isAnswered = (draft: Draft): boolean =>
  draft.labels.length > 0 || (draft.otherSelected && draft.other.trim().length > 0);

const toAnswers = (questions: IAskQuestion[], drafts: Draft[]): AskAnswer[] =>
  questions.map((question, index) => {
    const draft = drafts[index] ?? emptyDraft();
    const labels = [...draft.labels];
    if (draft.otherSelected && draft.other.trim()) labels.push(draft.other.trim());
    return { question: question.question, labels };
  });

const askQuestionsOf = (message: IMessageAsk): IAskQuestion[] =>
  Array.isArray(message.content?.questions) ? message.content.questions : [];

const requestIdOf = (message: IMessageAsk): string => message.content?.request_id || message.id;

/** The newest question card still waiting for an answer, if any. */
export const findPendingAsk = (list: TMessage[]): IMessageAsk | undefined => {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message.type !== 'ask') continue;
    if (askQuestionsOf(message).length === 0) continue;
    if (getAskSettlement(requestIdOf(message))) continue;
    return message;
  }
  return undefined;
};

const QuestionForm: React.FC<{ message: IMessageAsk }> = ({ message }) => {
  const { t } = useTranslation();
  const questions = askQuestionsOf(message);
  const requestId = requestIdOf(message);
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft));
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    },
    []
  );

  const total = questions.length;
  const question = questions[step];
  const draft = drafts[step] ?? emptyDraft();
  const multi = isMultiSelect(question);
  const isLast = step === total - 1;
  const allAnswered = drafts.every(isAnswered);
  // Jump to the first unanswered question rather than blindly submitting.
  const firstUnanswered = drafts.findIndex((item) => !isAnswered(item));

  const updateDraft = useCallback(
    (patch: Partial<Draft>) => {
      setDrafts((previous) => previous.map((item, index) => (index === step ? { ...item, ...patch } : item)));
    },
    [step]
  );

  const send = useCallback(
    async (payload: { answers: AskAnswer[] } | { decline: true }) => {
      setSubmitting(true);
      const result = await submitAsk(message.conversation_id, requestId, payload);
      setSubmitting(false);
      if (result === 'expired') Message.warning(t('messages.askExpired'));
      if (result === 'failed') Message.error(t('messages.askSubmitFailed'));
    },
    [message.conversation_id, requestId, t]
  );

  const handleSingleChange = (value: string) => {
    if (value === OTHER_VALUE) {
      updateDraft({ labels: [], otherSelected: true });
      return;
    }
    updateDraft({ labels: [value], otherSelected: false });
    if (!isLast) {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => setStep((current) => Math.min(current + 1, total - 1)), AUTO_ADVANCE_MS);
    }
  };

  const handlePrimary = () => {
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    if (!allAnswered) {
      setStep(firstUnanswered);
      return;
    }
    void send({ answers: toAnswers(questions, drafts) });
  };

  return (
    <div className={styles.dock} role='dialog' aria-label={t('messages.askDialogTitle')} data-testid='question-dialog'>
      <div className={styles.head}>
        <Help theme='outline' size='16' fill='rgb(var(--primary-6))' />
        <span className={styles.title}>{t('messages.askDialogTitle')}</span>
        {question.header ? <span className={styles.chip}>{question.header}</span> : null}
        {total > 1 ? (
          <span className={styles.progress} data-testid='question-dialog-progress'>
            {t('messages.askProgress', { current: step + 1, total })}
          </span>
        ) : (
          <span className={styles.progress} />
        )}
        <Tooltip content={t('messages.askMinimize')}>
          <Button
            type='text'
            size='mini'
            aria-label={t('messages.askMinimize')}
            icon={<Down theme='outline' size='14' />}
            onClick={() => setAskMinimized(requestId, true)}
            data-testid='question-dialog-minimize'
          />
        </Tooltip>
        <Tooltip content={t('messages.askDecline')}>
          <Button
            type='text'
            size='mini'
            aria-label={t('messages.askDecline')}
            icon={<Close theme='outline' size='14' />}
            disabled={submitting}
            onClick={() => void send({ decline: true })}
            data-testid='question-dialog-decline'
          />
        </Tooltip>
      </div>

      <div className={styles.body}>
        <div className={own.question}>{question.question}</div>
        {multi ? (
          <Checkbox.Group
            className={own.optionList}
            value={draft.labels}
            onChange={(labels) => updateDraft({ labels: labels as string[] })}
            disabled={submitting}
          >
            {question.options.map((option) => (
              <Checkbox
                key={option.label}
                className={own.optionRow}
                value={option.label}
                data-testid={`question-dialog-option-${step}-${option.label}`}
              >
                <span className={own.optionText}>
                  <span className={own.optionLabel}>{option.label}</span>
                  {option.description ? <span className={own.optionDesc}>{option.description}</span> : null}
                </span>
              </Checkbox>
            ))}
          </Checkbox.Group>
        ) : (
          <Radio.Group
            className={own.optionList}
            value={draft.otherSelected ? OTHER_VALUE : draft.labels[0]}
            onChange={handleSingleChange}
            disabled={submitting}
          >
            {question.options.map((option) => (
              <Radio
                key={option.label}
                className={own.optionRow}
                value={option.label}
                data-testid={`question-dialog-option-${step}-${option.label}`}
              >
                <span className={own.optionText}>
                  <span className={own.optionLabel}>{option.label}</span>
                  {option.description ? <span className={own.optionDesc}>{option.description}</span> : null}
                </span>
              </Radio>
            ))}
            <Radio className={own.optionRow} value={OTHER_VALUE} data-testid={`question-dialog-option-${step}-other`}>
              <span className={own.optionText}>
                <span className={own.optionLabel}>{t('messages.askOther')}</span>
              </span>
            </Radio>
          </Radio.Group>
        )}
        {!multi && draft.otherSelected ? (
          <Input
            autoFocus
            className={own.otherInput}
            placeholder={t('messages.askOtherPlaceholder')}
            value={draft.other}
            onChange={(value) => updateDraft({ other: value })}
            onPressEnter={handlePrimary}
            disabled={submitting}
            data-testid={`question-dialog-other-input-${step}`}
          />
        ) : null}
      </div>

      <div className={styles.foot}>
        {step > 0 ? (
          <Button size='small' disabled={submitting} onClick={() => setStep(step - 1)}>
            {t('messages.askPrevious')}
          </Button>
        ) : null}
        <span className={styles.footSpacer} />
        {isLast && !allAnswered && total > 1 ? (
          <span className={styles.hint}>{t('messages.askAnswerAllHint')}</span>
        ) : null}
        <Button
          type='primary'
          size='small'
          loading={submitting}
          disabled={!isAnswered(draft)}
          onClick={handlePrimary}
          data-testid='question-dialog-primary'
        >
          {isLast ? t('messages.askSubmit') : t('messages.askNext')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Pops the newest unanswered question card (AskUserQuestion) up as a dialog
 * above the composer. Mounted inside the send box, so every chat platform
 * gets it; renders nothing when no question is waiting.
 */
const QuestionDialog: React.FC = () => {
  const { t } = useTranslation();
  const list = useMessageList();
  const storeVersion = useAskStoreVersion();
  // storeVersion is a dependency on purpose: answering changes the result
  // without changing the message list.
  const pending = useMemo(() => findPendingAsk(list ?? []), [list, storeVersion]);
  if (!pending) return null;

  const requestId = requestIdOf(pending);
  if (isAskMinimized(requestId)) {
    return (
      <div className={styles.pill} data-testid='question-dialog-pill'>
        <span className={styles.pillDot} />
        <span>{t('messages.askWaiting', { count: askQuestionsOf(pending).length })}</span>
        <Button size='mini' type='primary' onClick={() => setAskMinimized(requestId, false)}>
          {t('messages.askReopen')}
        </Button>
      </div>
    );
  }

  return <QuestionForm key={requestId} message={pending} />;
};

export default QuestionDialog;
