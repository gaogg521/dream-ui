/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test for a real production bug: the "after top-up" preview
 * added the raw amount the user was about to pay straight onto the current
 * balance, ignoring the platform's resale markup entirely. A user with a
 * ¥5 free balance who paid ¥1 saw a "充值后 ¥6.00" preview but the broker
 * only ever credits `paidAmount / markup` — the real balance afterward was
 * ¥5.87 (confirmed live against the vendor's own account API while
 * diagnosing this). This pins the preview to the same math the backend
 * actually applies, via `grantedForPayment`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { amount?: string; min?: number }) =>
      opts?.amount !== undefined ? `${k}:${opts.amount}` : opts?.min !== undefined ? `${k}:${opts.min}` : k,
    i18n: { language: 'en' },
  }),
}));

const quota = vi.hoisted(() => ({
  data: {
    kind: 'issued' as const,
    vendor: 'baoyun' as const,
    // The exact production shape at the time this was reported: ¥5
    // remaining, 1.15x markup.
    data: { remaining_usd: 5, exhausted: false, currency: 'CNY', topup_price_markup: 1.15 },
  } as unknown,
}));

vi.mock('@renderer/hooks/agent/useTrialQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/hooks/agent/useTrialQuota')>();
  return {
    ...actual,
    useTrialQuota: () => ({ data: quota.data }),
    useRefreshTrialQuota: () => vi.fn(),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: { mode: { topupCreateOrder: { invoke: vi.fn() }, topupGetOrder: { invoke: vi.fn() } } },
}));

// DreamModal needs a ThemeProvider ancestor for its own chrome (header
// close button, sizing); none of that is what this test is about, so a
// bare pass-through keeps the test focused on TrialTopUpModal's own math.
vi.mock('@renderer/components/base/DreamModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div>{children}</div> : null,
}));

import TrialTopUpModal from '@/renderer/pages/settings/components/TrialTopUpModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TrialTopUpModal preview', () => {
  it('shows what a top-up will actually credit, not the raw paid amount', () => {
    render(<TrialTopUpModal visible vendor='baoyun' onClose={vi.fn()} />);

    // Pick the ¥10 quick amount.
    fireEvent.click(screen.getByText('settings.trialTopUp.amountOption:10'));

    // 5 (current) + grantedForPayment(1.15, 10) = 5 + 8.70 = ¥13.70 — never
    // the naive 5 + 10 = ¥15.00 the bug produced.
    expect(screen.getByText('settings.trialTopUp.afterTopUp:¥13.70')).toBeTruthy();
    expect(screen.queryByText('settings.trialTopUp.afterTopUp:¥15.00')).toBeNull();
  });

  it('reproduces the exact reported case: ¥5 balance, ¥1 paid, ¥5.87 after', () => {
    render(<TrialTopUpModal visible vendor='baoyun' onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('settings.trialTopUp.amountPlaceholder:1');
    fireEvent.change(input, { target: { value: '1' } });

    expect(screen.getByText('settings.trialTopUp.afterTopUp:¥5.87')).toBeTruthy();
  });
});
