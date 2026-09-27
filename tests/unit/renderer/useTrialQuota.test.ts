/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * `grantedForPayment` mirrors the broker's `granted_for_payment`
 * (dream-trial-broker `src/topup.rs`) exactly — same ratio, same
 * round-to-cents. A top-up preview that instead adds the raw paid amount
 * directly overstates the result by the markup ratio: at the production
 * default (1.15x), paying ¥1 with a ¥5 balance showed a ¥6.00 preview but
 * only ¥5.87 actually landed (real production key, confirmed against the
 * vendor's own account API). These cases pin the fix.
 */

import { describe, it, expect } from 'vitest';
import { grantedForPayment } from '@renderer/hooks/agent/useTrialQuota';

describe('grantedForPayment', () => {
  it('applies the markup and rounds to cents, matching the broker exactly', () => {
    // Same two cases the broker's own granted_for_payment test asserts —
    // if the ratio or rounding ever drifts between the two, this fails
    // before a user ever sees a wrong number.
    expect(grantedForPayment(1.15, 11.5)).toBe(10.0);
    expect(grantedForPayment(1.15, 10.0)).toBe(8.7);
  });

  it('reproduces the real production case that was reported as a bug', () => {
    // install_01a0e177-...: ¥5 free grant, paid ¥1, ended up with ¥5.87 —
    // verified live against Baoyun's account API while diagnosing this.
    expect(5 + grantedForPayment(1.15, 1.0)).toBeCloseTo(5.87, 2);
  });

  it('falls back to no markup (rate 1) when the field is missing', () => {
    // An old broker build, or a response that never set the field — the
    // preview must not silently apply some other ratio.
    expect(grantedForPayment(undefined, 20)).toBe(20);
    expect(grantedForPayment(null, 20)).toBe(20);
  });

  it('treats a non-positive markup as no markup rather than dividing by zero or inverting', () => {
    expect(grantedForPayment(0, 20)).toBe(20);
    expect(grantedForPayment(-1, 20)).toBe(20);
  });

  it('is the identity at markup 1.0', () => {
    expect(grantedForPayment(1.0, 42.5)).toBe(42.5);
  });
});
