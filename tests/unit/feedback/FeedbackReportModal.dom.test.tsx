/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * White-box tests for FeedbackReportModal's prefill behavior.
 * Verifies that defaultModule + prefilledScreenshots props seed the form
 * when the modal becomes visible, and that cancel clears the form.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';

const modalConfirmMock = vi.hoisted(() => vi.fn());

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
    Modal: {
      ...actual.Modal,
      confirm: modalConfirmMock,
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// FeedbackReportModal now renders through DreamModal, which reads ThemeContext
// for font scaling. Provide a minimal theme so the modal mounts without a full
// ThemeProvider (which pulls in IPC-backed theme loading).
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));

// FeedbackReportModal reads useAuth() to silently attach the signed-in user's
// account email to the report. Mock it with a mutable holder so individual
// tests can flip between a logged-out user (no email attached) and one that
// carries an email.
const authMock = vi.hoisted(() => ({
  user: null as { id: string; username: string; email?: string } | null,
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: authMock.user }),
}));

const sendFeedback = vi.hoisted(() => vi.fn());

const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl }));

import FeedbackReportModal, {
  type PrefilledScreenshot,
} from '@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal';

const renderModal = (ui: React.ReactElement) => render(<ConfigProvider>{ui}</ConfigProvider>);

const buildScreenshot = (name: string, byte: number): PrefilledScreenshot => ({
  filename: name,
  data: new Uint8Array([byte, byte + 1, byte + 2]),
  type: 'image/png',
});

describe('FeedbackReportModal — prefill', () => {
  beforeEach(() => {
    // Ensure no leftover global electronAPI from other tests interferes.
    (window as unknown as { electronAPI?: unknown }).electronAPI = { submitFeedbackReport: sendFeedback };
    sendFeedback.mockReset().mockResolvedValue({ eventId: 'confirmed-id', acceptedAt: 1 });
    window.location.hash = '';
    authMock.user = null;
    openExternalUrl.mockClear();
    modalConfirmMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render form content when visible=false', () => {
    renderModal(<FeedbackReportModal visible={false} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('feedback-report-scroll-body')).not.toBeInTheDocument();
  });

  it('renders the form body when visible=true', () => {
    renderModal(<FeedbackReportModal visible={true} onCancel={vi.fn()} />);
    expect(screen.getByTestId('feedback-report-scroll-body')).toBeInTheDocument();
  });

  it('applies defaultModule on open, showing it as the selected option', () => {
    renderModal(<FeedbackReportModal visible={true} onCancel={vi.fn()} defaultModule='mcp-tools' />);
    // The select shows the i18n key (mock returns the key itself). That is how other
    // tests in this repo verify module labels with the t() → identity mock.
    expect(screen.getByText('settings.bugReportModuleMcp')).toBeInTheDocument();
  });

  it('seeds the Upload list with prefilled screenshots', () => {
    const shots = [buildScreenshot('shot-a.png', 1), buildScreenshot('shot-b.png', 10)];
    renderModal(
      <FeedbackReportModal
        visible={true}
        onCancel={vi.fn()}
        defaultModule='conversation-session'
        prefilledScreenshots={shots}
      />
    );

    // The picture-card Upload renders one .arco-upload-list-item per screenshot.
    // Arco also appends a separate `+` trigger until the 3-item limit is hit.
    expect(document.querySelectorAll('.arco-upload-list-item').length).toBe(2);
  });

  it('shows the uploaded count next to the screenshot label when seeded', () => {
    const shots = [buildScreenshot('a.png', 1), buildScreenshot('b.png', 2)];
    renderModal(
      <FeedbackReportModal visible={true} onCancel={vi.fn()} defaultModule='mcp-tools' prefilledScreenshots={shots} />
    );
    expect(screen.getByTestId('feedback-report-screenshot-count')).toBeInTheDocument();
  });

  it('hides the uploaded count when no screenshots are attached', () => {
    renderModal(<FeedbackReportModal visible={true} onCancel={vi.fn()} defaultModule='mcp-tools' />);
    expect(screen.queryByTestId('feedback-report-screenshot-count')).not.toBeInTheDocument();
  });

  it('caps prefilled screenshots to the 3-item upload limit', () => {
    const shots = [
      buildScreenshot('a.png', 1),
      buildScreenshot('b.png', 2),
      buildScreenshot('c.png', 3),
      buildScreenshot('d.png', 4),
      buildScreenshot('e.png', 5),
    ];
    renderModal(
      <FeedbackReportModal
        visible={true}
        onCancel={vi.fn()}
        defaultModule='system-settings'
        prefilledScreenshots={shots}
      />
    );

    // Only the first 3 screenshots make it into the Upload list.
    expect(document.querySelectorAll('.arco-upload-list-item').length).toBe(3);
    // When the limit is hit Arco hides the `+` trigger tile.
    expect(document.querySelector('.arco-upload-trigger-picture')).toBeNull();
  });

  it('calls onCancel when the close button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible={true} onCancel={onCancel} defaultModule='agent-detection' />);

    const closeBtn = document.querySelector('button[aria-label="Close"]') as HTMLElement | null;
    expect(closeBtn).not.toBeNull();
    await user.click(closeBtn!);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('submits tags and context and shows an inline receipt only after acknowledgement', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderModal(
      <FeedbackReportModal
        visible
        onCancel={onCancel}
        defaultModule='conversation-session'
        feedbackTags={{ source: 'test' }}
        feedbackExtra={{ trace: 'safe' }}
      />
    );
    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'provider failed');
    await user.click(screen.getByText('settings.bugReportSubmit'));
    await screen.findByText('settings.bugReportSuccess');
    expect(sendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'conversation-session',
        description: 'provider failed',
        tags: { source: 'test' },
        extra: { trace: 'safe' },
        attachments: [],
      })
    );
    expect(onCancel).not.toHaveBeenCalled();
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it('submits route and module diagnostics context for DB attachment collection', async () => {
    window.location.hash = '#/conversation/conv-1';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            schema_version: 'feedback-diagnostics/v1',
            profiles: [],
            privacy: { raw_content_included: false, api_keys_included: false },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderModal(
      <FeedbackReportModal
        visible={true}
        onCancel={vi.fn()}
        defaultModule='system-settings'
        feedbackDiagnosticsContext={{
          explicitContext: { conversationId: 'conv-1' },
          explicitProfiles: ['conversation-session'],
          routeAtOpen: '#/conversation/conv-1',
        }}
      />
    );

    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'wrong module selected');
    await user.click(screen.getByText('settings.bugReportSubmit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
    });
    const [path, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toContain('/api/system/diagnostics/feedback-report?');
    expect(path).toContain('conversation_id=conv-1');
    expect(path).toContain('profiles=conversation-session');
    expect(path).toContain('route_at_open=%23%2Fconversation%2Fconv-1');
    expect(path).toContain('route_at_submit=%23%2Fconversation%2Fconv-1');
    expect(path).toContain('selected_module=system-settings');
    expect(options.method).toBe('GET');
  });

  it('attaches the signed-in account email to the feedback event', async () => {
    authMock.user = { id: 'u1', username: 'user-one', email: '  me@account.com  ' };
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible={true} onCancel={vi.fn()} defaultModule='conversation-session' />);

    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'something broke');
    await user.click(screen.getByText('settings.bugReportSubmit'));

    await waitFor(() => {
      expect(sendFeedback).toHaveBeenCalledTimes(1);
    });

    // The account email rides along on THIS event's scoped user (trimmed), with
    // no visible field for the reporter to fill in or edit.
    expect(sendFeedback).toHaveBeenCalledWith(expect.objectContaining({ contactEmail: 'me@account.com' }));
  });

  it('submits without a scoped user when the signed-in user has no email', async () => {
    authMock.user = { id: 'u1', username: 'user-one' };
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible={true} onCancel={vi.fn()} defaultModule='conversation-session' />);

    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'something broke');
    await user.click(screen.getByText('settings.bugReportSubmit'));

    await waitFor(() => {
      expect(sendFeedback).toHaveBeenCalledTimes(1);
    });

    expect(sendFeedback.mock.calls[0][0].contactEmail).toBeUndefined();
  });

  it('opens QQ directly without submitting a report or showing success', async () => {
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible onCancel={vi.fn()} />);
    expect(screen.queryByText('settings.bugReportSuccess')).not.toBeInTheDocument();
    await user.click(screen.getByText('settings.feedbackOpenQq'));
    expect(openExternalUrl).toHaveBeenCalledWith(expect.stringContaining('uin=475332294'));
    expect(sendFeedback).not.toHaveBeenCalled();
    expect(screen.queryByText('settings.bugReportSuccess')).not.toBeInTheDocument();
  });
  it('opens an email draft only on explicit click, without submitting online', async () => {
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible onCancel={vi.fn()} defaultModule='conversation-session' />);
    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'draft details');
    await user.click(screen.getByText('settings.bugReportEmailConfirmOk'));
    expect(decodeURIComponent(openExternalUrl.mock.calls[0][0])).toContain('draft details');
    expect(openExternalUrl.mock.calls[0][0]).toMatch(/^mailto:475332294@qq.com/);
    expect(sendFeedback).not.toHaveBeenCalled();
    expect(screen.queryByText('settings.bugReportSuccess')).not.toBeInTheDocument();
  });
  it('keeps the draft and screenshots when delivery fails', async () => {
    sendFeedback.mockRejectedValue(new Error('service unavailable'));
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible onCancel={vi.fn()} defaultModule='conversation-session' />);
    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'keep my report');
    await user.click(screen.getByText('settings.bugReportSubmit'));
    await screen.findByText('settings.bugReportError');
    expect(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder')).toHaveValue('keep my report');
    expect(screen.queryByText('settings.bugReportSuccess')).not.toBeInTheDocument();
  });
  it('does not show success while waiting for the delivery receipt', async () => {
    let accept!: (value: { eventId: string; acceptedAt: number }) => void;
    sendFeedback.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          accept = resolve;
        })
    );
    const user = userEvent.setup();
    renderModal(<FeedbackReportModal visible onCancel={vi.fn()} defaultModule='conversation-session' />);
    await user.type(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder'), 'pending report');
    await user.click(screen.getByText('settings.bugReportSubmit'));
    await waitFor(() => expect(sendFeedback).toHaveBeenCalled());
    expect(screen.queryByText('settings.bugReportSuccess')).not.toBeInTheDocument();
    accept({ eventId: 'real-receipt', acceptedAt: 1 });
    await screen.findByText('settings.bugReportSuccess');
  });

  it('no longer renders the contact email field or its account-fill button', () => {
    authMock.user = { id: 'u1', username: 'user-one', email: 'me@account.com' };
    renderModal(<FeedbackReportModal visible={true} onCancel={vi.fn()} />);
    // Positive control: the description field still renders, so the modal mounted.
    expect(screen.getByPlaceholderText('settings.bugReportDescriptionPlaceholder')).toBeInTheDocument();
    // The removed contact email input and its "use account email" button are gone.
    expect(screen.queryByPlaceholderText('settings.bugReportContactEmailPlaceholder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-feedback-use-account-email')).not.toBeInTheDocument();
  });
});
