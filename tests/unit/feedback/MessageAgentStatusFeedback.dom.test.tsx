/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration test for the FeedbackButton wired into MessageAgentStatus.
 * Ensures the link is shown only on 'error' status and invokes the feedback
 * hook with the 'conversation-session' module.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts?.agent) return `${k}:${String(opts.agent)}`;
      return k;
    },
    i18n: { language: 'en' },
  }),
}));

const openFeedbackMock = vi.fn(() => Promise.resolve());
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: openFeedbackMock }),
}));

import MessageAgentStatus from '@/renderer/pages/conversation/Messages/components/MessageAgentStatus';
import type { IMessageAgentStatus } from '@/common/chat/chatLib';

const buildMessage = (status: IMessageAgentStatus['content']['status']): IMessageAgentStatus =>
  ({
    id: 'm1',
    type: 'agent_status',
    content: {
      backend: 'claude',
      status,
      agent_name: 'Claude',
    },
  }) as IMessageAgentStatus;

describe('MessageAgentStatus — FeedbackButton wiring', () => {
  beforeEach(() => {
    openFeedbackMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render FeedbackButton on successful statuses', () => {
    render(<MessageAgentStatus message={buildMessage('connected')} />);
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });

  it('renders FeedbackButton when agent status is error', () => {
    render(<MessageAgentStatus message={buildMessage('error')} />);
    expect(screen.getByText('settings.oneClickFeedback')).toBeInTheDocument();
  });

  it('opens feedback with module=conversation-session on click', async () => {
    const user = userEvent.setup();
    render(<MessageAgentStatus message={buildMessage('error')} />);
    await user.click(screen.getByText('settings.oneClickFeedback'));

    expect(openFeedbackMock).toHaveBeenCalledTimes(1);
    expect(openFeedbackMock).toHaveBeenCalledWith({
      module: 'conversation-session',
      autoScreenshot: true,
    });
  });

  // This used to assert a JS-side capitalisation of the raw identifier, and that
  // behaviour was deliberately removed: it turned 'dream' into "DreamEngine" —
  // an internal codename shown to users. The identifier is now passed through
  // untouched and capitalised by CSS, which the DOM text does not reflect.
  //
  // Kept rather than deleted because the fallback order still matters: with no
  // catalog row the component must show *something* instead of an empty label.
  it('falls back to the raw backend identifier when the catalog has no row for it', () => {
    render(
      <MessageAgentStatus
        message={
          {
            id: 'm2',
            type: 'agent_status',
            content: {
              backend: 'codex',
              status: 'connected',
            },
          } as IMessageAgentStatus
        }
      />
    );

    const label = screen.getByText('codex');
    expect(label).toBeInTheDocument();
    // The capitalisation the user sees is CSS, not a rewritten string.
    expect(label.className).toContain('capitalize');
    expect(screen.getByText('acp.status.connected:codex')).toBeInTheDocument();
  });
});
