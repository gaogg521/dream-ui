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
import { render, screen, cleanup } from '@testing-library/react';
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
});
