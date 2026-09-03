/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { formatMinorUnits, remainingLabel, type TrialQuotaView } from '@/renderer/hooks/agent/useTrialQuota';

describe('formatMinorUnits', () => {
  it('renders a known currency with its symbol', () => {
    expect(formatMinorUnits(978, 'CNY')).toBe('¥9.78');
    expect(formatMinorUnits(5900, 'CNY')).toBe('¥59.00');
    expect(formatMinorUnits(0, 'CNY')).toBe('¥0.00');
  });

  it('falls back to a code suffix for an unknown currency', () => {
    expect(formatMinorUnits(1234, 'XXX')).toBe('12.34 XXX');
  });
});

describe('remainingLabel', () => {
  it('reads a metered view from its cents ledger', () => {
    const view: TrialQuotaView = {
      kind: 'metered',
      vendor: 'baoyun',
      data: {
        vendor: 'baoyun',
        currency: 'CNY',
        free_grant_cents: 1000,
        purchased_cents: 0,
        consumed_cents: 22,
        remaining_cents: 978,
        exhausted: false,
      },
    };
    expect(remainingLabel(view)).toEqual({ text: '¥9.78', exhausted: false });
  });

  it('flags a spent metered balance', () => {
    const view: TrialQuotaView = {
      kind: 'metered',
      vendor: 'baoyun',
      data: {
        vendor: 'baoyun',
        currency: 'CNY',
        free_grant_cents: 1000,
        purchased_cents: 0,
        consumed_cents: 1000,
        remaining_cents: 0,
        exhausted: true,
      },
    };
    expect(remainingLabel(view)).toEqual({ text: '¥0.00', exhausted: true });
  });

  it('reads an issued view in USD, and empty text when the vendor reports no cap', () => {
    const capped: TrialQuotaView = {
      kind: 'issued',
      vendor: 'openrouter',
      data: {
        vendor: 'openrouter',
        limit_usd: 1,
        used_usd: 0.58,
        remaining_usd: 0.42,
        reset: 'monthly',
        exhausted: false,
      },
    };
    expect(remainingLabel(capped)).toEqual({ text: '$0.42', exhausted: false });

    const uncapped: TrialQuotaView = {
      kind: 'issued',
      vendor: 'openrouter',
      data: { vendor: 'openrouter', limit_usd: null, used_usd: 3, remaining_usd: null, reset: null, exhausted: false },
    };
    expect(remainingLabel(uncapped)).toEqual({ text: '', exhausted: false });
  });
});
