/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The broker now keeps the free-grant pool and the paid pool separate and
 * markup-free on the wire (`crate::visible_balance`) — a top-up preview is
 * just `paidRemaining + amount`, no client-side markup math. This pins that
 * behavior and the grant/paid split display, and stands in for the old
 * `grantedForPayment` regression test (removed once the split shipped: see
 * dream-trial-broker's session doc for the production bug that motivated
 * all of this — a ¥1 payment on a ¥5 balance showing a preview the backend
 * could not actually deliver).
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
    data: {
      vendor: 'baoyun',
      limit_usd: 5,
      used_usd: 0,
      remaining_usd: 5,
      grant_limit_usd: 5,
      grant_remaining_usd: 5,
      paid_limit_usd: 0,
      paid_remaining_usd: 0,
      reset: null,
      exhausted: false,
      currency: 'CNY',
    },
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
// bare pass-through keeps the test focused on TrialTopUpModal's own logic.
vi.mock('@renderer/components/base/DreamModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div>{children}</div> : null,
}));

import TrialTopUpModal from '@/renderer/pages/settings/components/TrialTopUpModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TrialTopUpModal balance split', () => {
  it('shows the grant and paid balances as two separate rows', () => {
    render(<TrialTopUpModal visible vendor='baoyun' onClose={vi.fn()} />);
    expect(screen.getByTestId('grant-balance-row').textContent).toContain('¥5.00');
    expect(screen.getByTestId('paid-balance-row').textContent).toContain('¥0.00');
  });

  it('previews a top-up as a plain addition to the paid row — no markup math on the client', () => {
    render(<TrialTopUpModal visible vendor='baoyun' onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('settings.trialTopUp.amountOption:10'));

    // ¥0 paid balance + ¥10 paid, at face value — the exact naive addition
    // that used to be wrong when the broker's response still carried the
    // markup ratio. Now the broker has already done the conversion
    // server-side, so this IS the correct number.
    expect(screen.getByTestId('paid-balance-row').textContent).toContain('¥10.00');
    // The grant row is never touched by a payment.
    expect(screen.getByTestId('grant-balance-row').textContent).toContain('¥5.00');
  });

  it('reproduces the exact reported case: ¥0 paid balance, ¥1 paid, ¥1.00 after — not a discounted ¥0.87', () => {
    render(<TrialTopUpModal visible vendor='baoyun' onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('settings.trialTopUp.amountPlaceholder:1');
    fireEvent.change(input, { target: { value: '1' } });

    expect(screen.getByTestId('paid-balance-row').textContent).toContain('¥1.00');
  });

  it('falls back to a single combined preview when the broker has no grant/paid split to report', () => {
    quota.data = {
      kind: 'issued',
      vendor: 'baoyun',
      data: {
        vendor: 'baoyun',
        limit_usd: 5,
        used_usd: 0,
        remaining_usd: 5,
        grant_limit_usd: null,
        grant_remaining_usd: null,
        paid_limit_usd: null,
        paid_remaining_usd: null,
        reset: null,
        exhausted: false,
        currency: 'CNY',
      },
    };
    render(<TrialTopUpModal visible vendor='baoyun' onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('settings.trialTopUp.amountOption:10'));

    expect(screen.getByText('settings.trialTopUp.afterTopUp:¥15.00')).toBeTruthy();
    expect(screen.queryByTestId('grant-balance-row')).toBeNull();
    expect(screen.queryByTestId('paid-balance-row')).toBeNull();
  });
});
