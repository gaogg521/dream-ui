/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * `grantRemainingAmount`/`paidRemainingAmount` are typed accessors onto the
 * broker's already-split visible balance (`crate::visible_balance`) — the
 * broker keeps the free-grant pool markup-free and separate from the paid
 * pool server-side now, so there is no client-side markup math left to test
 * (that used to live here as `grantedForPayment`, removed once the split
 * shipped — see dream-trial-broker's session doc for the full story).
 */

import { describe, it, expect } from 'vitest';
import { grantRemainingAmount, paidRemainingAmount, type TrialQuotaView } from '@renderer/hooks/agent/useTrialQuota';
import type { MeteredQuotaStatusResponse, TrialQuotaStatusResponse } from '@/common/types/provider/providerApi';

function issuedView(overrides: Partial<TrialQuotaStatusResponse>): TrialQuotaView {
  return {
    kind: 'issued',
    vendor: 'baoyun',
    data: {
      vendor: 'baoyun',
      limit_usd: null,
      used_usd: 0,
      remaining_usd: null,
      grant_limit_usd: null,
      grant_remaining_usd: null,
      paid_limit_usd: null,
      paid_remaining_usd: null,
      reset: null,
      exhausted: false,
      currency: 'CNY',
      ...overrides,
    },
  };
}

describe('grantRemainingAmount / paidRemainingAmount', () => {
  it('read the split fields straight through for an issued view', () => {
    const view = issuedView({ grant_remaining_usd: 5, paid_remaining_usd: 13.7 });
    expect(grantRemainingAmount(view)).toBe(5);
    expect(paidRemainingAmount(view)).toBe(13.7);
  });

  it('is null for a metered view — mode B never had a grant/paid split', () => {
    const data: MeteredQuotaStatusResponse = {
      vendor: 'baoyun',
      currency: 'CNY',
      free_grant_cents: 500,
      purchased_cents: 0,
      consumed_cents: 0,
      remaining_cents: 500,
      exhausted: false,
    };
    const view: TrialQuotaView = { kind: 'metered', vendor: 'baoyun', data };
    expect(grantRemainingAmount(view)).toBeNull();
    expect(paidRemainingAmount(view)).toBeNull();
  });

  it('is null when the vendor reports no cap concept at all', () => {
    const view = issuedView({ grant_remaining_usd: null, paid_remaining_usd: null });
    expect(grantRemainingAmount(view)).toBeNull();
    expect(paidRemainingAmount(view)).toBeNull();
  });
});
