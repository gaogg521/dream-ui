/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAsk } from '@/common/chat/chatLib';
import MessageQuestion from '@/renderer/pages/conversation/Messages/MessageQuestion';

const { answerAskInvoke } = vi.hoisted(() => ({
  answerAskInvoke: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    answerAsk: {
      invoke: answerAskInvoke,
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
    ],
  },
});

describe('MessageQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answerAskInvoke.mockResolvedValue(undefined);
  });

  it('keeps the submit action disabled until an answer is selected, then sends the selected label', async () => {
    render(<MessageQuestion message={makeMessage()} />);

    const submit = screen.getByTestId('message-question-submit');
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId('message-question-option-0-Staging'));
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'request-1',
      answers: [{ question: 'Choose a release environment', labels: ['Staging'] }],
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
  });

  it('exposes an explicit decline action instead of sending an empty answer', async () => {
    render(<MessageQuestion message={makeMessage()} />);

    fireEvent.click(screen.getByTestId('message-question-decline'));

    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'request-1',
      decline: true,
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askDeclined');
  });
});
