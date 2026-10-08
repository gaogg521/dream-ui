/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAsk, TMessage } from '@/common/chat/chatLib';
import { MessageListProvider } from '@/renderer/pages/conversation/Messages/hooks';
import QuestionDialog, { findPendingAsk } from '@/renderer/pages/conversation/Messages/question/QuestionDialog';
import {
  getAskSettlement,
  resetAskStoreForTests,
  settleAsk,
} from '@/renderer/pages/conversation/Messages/question/askSettlementStore';

const { answerAskInvoke, messageWarning, messageError } = vi.hoisted(() => ({
  answerAskInvoke: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: { answerAsk: { invoke: answerAskInvoke } },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, warning: messageWarning, error: messageError } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'current' in options ? `${key}:${options.current}/${options.total}` : key,
  }),
}));

const ask = (requestId: string, questions: IMessageAsk['content']['questions']): IMessageAsk => ({
  id: `msg-${requestId}`,
  conversation_id: 'conversation-1',
  type: 'ask',
  content: { session_id: 'conversation-1', request_id: requestId, questions },
});

const twoQuestions = () =>
  ask('req-1', [
    {
      header: 'Audience',
      question: 'Who is the audience?',
      options: [{ label: 'Singles (Recommended)' }, { label: 'Couples' }],
    },
    {
      question: 'Which platforms?',
      multi_select: true,
      options: [{ label: 'Web' }, { label: 'App' }],
    },
  ]);

const renderWith = (list: TMessage[]) =>
  render(
    <MessageListProvider value={list}>
      <QuestionDialog />
    </MessageListProvider>
  );

/** A real HTTP failure as httpBridge throws it (duck-typed BackendHttpError). */
const httpError = (status: number) =>
  Object.assign(new Error(`failed (${status})`), { name: 'BackendHttpError', status, code: 'BAD_REQUEST' });

describe('QuestionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAskStoreForTests();
    answerAskInvoke.mockResolvedValue(undefined);
  });

  it('walks through the questions one at a time and submits every answer at once', async () => {
    renderWith([twoQuestions()]);

    expect(screen.getByTestId('question-dialog-progress')).toHaveTextContent('messages.askProgress:1/2');
    // Picking a single-select option moves on to the next question by itself.
    fireEvent.click(screen.getByText('Couples'));
    await waitFor(() =>
      expect(screen.getByTestId('question-dialog-progress')).toHaveTextContent('messages.askProgress:2/2')
    );

    const submit = screen.getByTestId('question-dialog-primary');
    expect(submit).toBeDisabled();
    // The step change came from a timer (outside act): let the new option
    // group's passive effects register its values, as a real frame would.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(screen.getByText('Web'));
    fireEvent.click(screen.getByText('App'));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(answerAskInvoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        request_id: 'req-1',
        answers: [
          { question: 'Who is the audience?', labels: ['Couples'] },
          { question: 'Which platforms?', labels: ['Web', 'App'] },
        ],
      })
    );
    await waitFor(() => expect(screen.queryByTestId('question-dialog')).toBeNull());
    expect(getAskSettlement('req-1')?.status).toBe('answered');
  });

  it('sends a free-text answer typed into "Other" as the label', async () => {
    renderWith([ask('req-2', [{ question: 'Which city?', options: [{ label: 'Beijing' }, { label: 'Shanghai' }] }])]);

    fireEvent.click(screen.getByText('messages.askOther'));
    fireEvent.change(screen.getByPlaceholderText('messages.askOtherPlaceholder'), { target: { value: 'Shenzhen' } });
    fireEvent.click(screen.getByTestId('question-dialog-primary'));

    await waitFor(() =>
      expect(answerAskInvoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        request_id: 'req-2',
        answers: [{ question: 'Which city?', labels: ['Shenzhen'] }],
      })
    );
  });

  it('dismissing sends an explicit decline, never an empty answer', async () => {
    renderWith([twoQuestions()]);

    fireEvent.click(screen.getByTestId('question-dialog-decline'));

    await waitFor(() =>
      expect(answerAskInvoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        request_id: 'req-1',
        decline: true,
      })
    );
    expect(getAskSettlement('req-1')?.status).toBe('declined');
  });

  it('minimizes to a pill and reopens with the draft position intact', () => {
    renderWith([twoQuestions()]);

    fireEvent.click(screen.getByTestId('question-dialog-minimize'));
    expect(screen.queryByTestId('question-dialog')).toBeNull();
    expect(screen.getByTestId('question-dialog-pill')).toHaveTextContent('messages.askWaiting');

    fireEvent.click(screen.getByText('messages.askReopen'));
    expect(screen.getByTestId('question-dialog')).toBeInTheDocument();
  });

  it('retires a question the backend rejects with 4xx (turn already stopped)', async () => {
    answerAskInvoke.mockRejectedValueOnce(httpError(400));
    renderWith([twoQuestions()]);

    fireEvent.click(screen.getByTestId('question-dialog-decline'));

    await waitFor(() => expect(getAskSettlement('req-1')?.status).toBe('expired'));
    expect(messageWarning).toHaveBeenCalledWith('messages.askExpired');
    expect(screen.queryByTestId('question-dialog')).toBeNull();
  });

  it('keeps the dialog open after a transient failure so the user can retry', async () => {
    answerAskInvoke.mockRejectedValueOnce(httpError(0));
    renderWith([twoQuestions()]);

    fireEvent.click(screen.getByTestId('question-dialog-decline'));

    await waitFor(() => expect(messageError).toHaveBeenCalledWith('messages.askSubmitFailed'));
    expect(getAskSettlement('req-1')).toBeUndefined();
    expect(screen.getByTestId('question-dialog')).toBeInTheDocument();
  });

  it('shows nothing when no question is waiting', () => {
    renderWith([]);
    expect(screen.queryByTestId('question-dialog')).toBeNull();
    expect(screen.queryByTestId('question-dialog-pill')).toBeNull();
  });
});

describe('findPendingAsk', () => {
  beforeEach(() => resetAskStoreForTests());

  it('picks the newest unsettled question and skips settled or empty ones', () => {
    const older = ask('old', [{ question: 'Q1?', options: [{ label: 'A' }, { label: 'B' }] }]);
    const newer = ask('new', [{ question: 'Q2?', options: [{ label: 'A' }, { label: 'B' }] }]);
    const empty = ask('empty', []);

    expect(findPendingAsk([older, newer, empty])?.content.request_id).toBe('new');
    act(() => settleAsk('new', { status: 'declined' }));
    expect(findPendingAsk([older, newer, empty])?.content.request_id).toBe('old');
    act(() => settleAsk('old', { status: 'expired' }));
    expect(findPendingAsk([older, newer, empty])).toBeUndefined();
  });
});
