/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAsk } from '@/common/chat/chatLib';
import MessageQuestion from '@/renderer/pages/conversation/Messages/MessageQuestion';
import {
  isAskMinimized,
  resetAskStoreForTests,
  setAskMinimized,
  settleAsk,
} from '@/renderer/pages/conversation/Messages/question/askSettlementStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'messages.askAnswerSeparator' ? ', ' : key),
  }),
}));

const makeMessage = (): IMessageAsk => ({
  id: 'ask-1',
  conversation_id: 'conversation-1',
  type: 'ask',
  content: {
    session_id: 'session-1',
    request_id: 'request-1',
    questions: [
      {
        header: 'Deployment',
        question: 'Choose a release environment',
        options: [
          { label: 'Staging', description: 'Internal test environment' },
          { label: 'Production', description: 'Customer-facing environment' },
        ],
      },
      {
        question: 'Which regions?',
        multiSelect: true,
        options: [{ label: 'EU' }, { label: 'US' }],
      },
    ],
  },
});

describe('MessageQuestion (transcript card)', () => {
  beforeEach(() => {
    resetAskStoreForTests();
  });

  it('points a pending question at the dialog and re-opens a minimized dialog', () => {
    setAskMinimized('request-1', true);
    render(<MessageQuestion message={makeMessage()} />);

    expect(screen.getByTestId('message-question-pending')).toHaveTextContent('messages.askPendingInline');
    // The transcript card is read-only: answering happens in the dialog.
    expect(screen.queryByRole('radio')).toBeNull();

    fireEvent.click(screen.getByTestId('message-question-open'));
    expect(isAskMinimized('request-1')).toBe(false);
  });

  it('shows what the user chose once the dialog settles the question', () => {
    render(<MessageQuestion message={makeMessage()} />);

    act(() => {
      settleAsk('request-1', {
        status: 'answered',
        answers: [
          { question: 'Choose a release environment', labels: ['Staging'] },
          { question: 'Which regions?', labels: ['EU', 'US'] },
        ],
      });
    });

    expect(screen.getByTestId('message-question-answer-0')).toHaveTextContent('Staging');
    expect(screen.getByTestId('message-question-answer-1')).toHaveTextContent('EU, US');
    expect(screen.getByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
    expect(screen.queryByTestId('message-question-pending')).toBeNull();
  });

  it('marks a question the backend no longer waits for as expired', () => {
    render(<MessageQuestion message={makeMessage()} />);

    act(() => settleAsk('request-1', { status: 'expired' }));

    expect(screen.getByTestId('message-question-status')).toHaveTextContent('messages.askExpired');
    expect(screen.queryByTestId('message-question-answer-0')).toBeNull();
  });
});
