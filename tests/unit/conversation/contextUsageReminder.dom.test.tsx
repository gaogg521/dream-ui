/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The context-usage indicator has to say something before the engine refuses
 * the turn. A ring that quietly changes colour is not a reminder: the reported
 * failure was a session that ran to "context window nearly full" with nothing
 * having told the user to compact.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { act, fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { ConfigProvider } from '@arco-design/web-react';
import { vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => {
      if (typeof fallback === 'string') return key;
      return key;
    },
    i18n: { language: 'en-US' },
  }),
}));

import ContextUsageIndicator from '@/renderer/components/agent/ContextUsageIndicator';
import type { TokenUsageData } from '@/common/config/storage';

const usage = (total: number): TokenUsageData => ({ total_tokens: total }) as TokenUsageData;

const renderIndicator = (total: number, limit: number) =>
  render(
    <ConfigProvider>
      <ContextUsageIndicator tokenUsage={usage(total)} context_limit={limit} />
    </ConfigProvider>
  );

const REMINDER_KEY = 'conversation.contextUsage.compactBadge';

describe('ContextUsageIndicator compaction reminder', () => {
  afterEach(() => cleanup());

  it('stays quiet below the threshold', () => {
    renderIndicator(700_000, 1_000_000);
    expect(screen.queryByText(new RegExp(REMINDER_KEY))).not.toBeInTheDocument();
  });

  it('shows the reminder in the toolbar past 80%', () => {
    renderIndicator(850_000, 1_000_000);
    expect(screen.getByText(new RegExp(REMINDER_KEY))).toBeInTheDocument();
  });

  it('says nothing when the window size is unknown', () => {
    // A percentage against a guessed denominator is not a fact, so there is
    // nothing honest to warn about — the popover reports the raw count instead.
    renderIndicator(850_000, 0);
    expect(screen.queryByText(new RegExp(REMINDER_KEY))).not.toBeInTheDocument();
  });

  it('offers a visible compact action without requiring hover, including before the warning threshold', async () => {
    const compact = vi.fn().mockResolvedValue(undefined);
    render(<ContextUsageIndicator tokenUsage={usage(12_000)} context_limit={1_000_000} onCompact={compact} />);
    const action = screen.getByRole('button', { name: 'conversation.contextUsage.compactAction' });
    expect(action).toBeVisible();
    fireEvent.click(action);
    await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
  });

  it('keeps compaction directly actionable when context is nearly full', async () => {
    const compact = vi.fn().mockResolvedValue(undefined);
    render(<ContextUsageIndicator tokenUsage={usage(850_000)} context_limit={1_000_000} onCompact={compact} />);
    expect(screen.getByText('85.0%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.contextUsage.compactAction' }));
    await waitFor(() => expect(compact).toHaveBeenCalledTimes(1));
  });

  it('explains unavailable or busy compaction instead of sending an unsupported command', () => {
    const compact = vi.fn();
    const view = render(<ContextUsageIndicator tokenUsage={usage(850_000)} context_limit={1_000_000} />);
    const action = screen.getByRole('button', { name: 'conversation.contextUsage.compactAction' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('aria-description', 'conversation.contextUsage.compactUnavailable');
    view.rerender(
      <ContextUsageIndicator
        tokenUsage={usage(850_000)}
        context_limit={1_000_000}
        onCompact={compact}
        compactDisabled
      />
    );
    fireEvent.click(action);
    expect(compact).not.toHaveBeenCalled();
    expect(action).toHaveAttribute('aria-description', 'conversation.contextUsage.compactBusy');
  });

  it('deduplicates pending clicks and permits retry after the send path reports failure', async () => {
    let fail: (reason: Error) => void = () => {};
    const compact = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        })
    );
    render(<ContextUsageIndicator tokenUsage={usage(850_000)} context_limit={1_000_000} onCompact={compact} />);
    const action = screen.getByRole('button', { name: 'conversation.contextUsage.compactAction' });
    fireEvent.click(action);
    fireEvent.click(action);
    expect(compact).toHaveBeenCalledTimes(1);
    await act(async () => {
      fail(new Error('already reported by send path'));
    });
    fireEvent.click(action);
    expect(compact).toHaveBeenCalledTimes(2);
    await act(async () => {
      fail(new Error('finish retry'));
    });
  });
});
