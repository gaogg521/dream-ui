/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The cost shown to the user must equal the cost recorded against the company.
 *
 * `pricing.ts` is a hand-written mirror of two Rust implementations, so the risk
 * this file exists to catch is drift: someone edits a rate in
 * `aionui-common/src/license.rs` and the app quietly starts quoting a stale
 * number. **The vectors below are copied verbatim from that crate's own tests**
 * (`media_is_priced_per_asset_and_per_second`) and from `one-billing`'s
 * `record_media_usage` tests, so a change on either side lands here as a
 * failure instead of on a user's invoice as a discrepancy.
 */

import { describe, expect, it } from 'vitest';
import {
  billableUnits,
  computeMediaCost,
  estimateMediaCostMicros,
  formatUsd,
  meterMediaJob,
} from '@/common/media/pricing';

describe('built-in rate table (mirrors aionui-common/src/license.rs)', () => {
  it('prices images per asset produced', () => {
    expect(estimateMediaCostMicros('image', 'gpt-image-2', 1, 0)).toBe(40_000);
    expect(estimateMediaCostMicros('image', 'gpt-image-2', 3, 0)).toBe(120_000);
  });

  it('prices video per second as well as per asset', () => {
    expect(estimateMediaCostMicros('video', 'seedance-2-0-fast', 1, 5)).toBe(1_000_000);
    expect(estimateMediaCostMicros('video', 'sora-2', 1, 10)).toBe(5_000_000);
  });

  it('does not make a video free when it declares no duration', () => {
    expect(estimateMediaCostMicros('video', 'seedance-2-0-fast', 1, 0)).toBe(
      estimateMediaCostMicros('video', 'seedance-2-0-fast', 1, 5)
    );
  });

  it('estimates unknown models at zero rather than guessing', () => {
    expect(estimateMediaCostMicros('image', 'some-unknown-model', 2, 0)).toBe(0);
  });

  it('never produces a negative charge from a nonsense count', () => {
    expect(estimateMediaCostMicros('image', 'gpt-image-2', -5, 0)).toBe(0);
  });
});

describe('billable units (mirrors record_media_usage)', () => {
  it('counts images, and seconds-per-asset for video', () => {
    expect(billableUnits('image', 3, 0)).toBe(3);
    // Two 5s clips cost the same as one 10s clip — the meter is per second of
    // produced video, not per job.
    expect(billableUnits('video', 2, 5)).toBe(10);
  });

  it('falls back to a typical clip length when duration is missing', () => {
    expect(billableUnits('video', 1, 0)).toBe(5);
  });
});

describe('computeMediaCost', () => {
  /**
   * Vectors from `one-billing/src/service.rs`: a user price of 2 micros on a
   * 4-second video charges 8 micros, and 7 micros × 3 images charges 21.
   */
  it("prefers the user's own price over the built-in table", () => {
    expect(
      computeMediaCost({
        kind: 'video',
        model: 'some-unknown-model',
        count: 1,
        durationSeconds: 4,
        userUnitPriceUsd: 0.000002,
      })
    ).toEqual({
      source: 'user',
      totalUsd: 0.000008,
    });
    expect(
      computeMediaCost({ kind: 'image', model: 'some-unknown-model', count: 3, userUnitPriceUsd: 0.000007 })
    ).toEqual({
      source: 'user',
      totalUsd: 0.000021,
    });
  });

  it('ignores a zero or negative user price and falls back to the table', () => {
    expect(computeMediaCost({ kind: 'image', model: 'gpt-image-2', count: 1, userUnitPriceUsd: 0 })).toEqual({
      source: 'builtin',
      totalUsd: 0.04,
    });
    expect(computeMediaCost({ kind: 'image', model: 'gpt-image-2', count: 1, userUnitPriceUsd: -3 })).toEqual({
      source: 'builtin',
      totalUsd: 0.04,
    });
  });

  /**
   * The one wrong answer worth ruling out: a paid generation reported as free.
   * An unrecognized model has no rate, and `$0.00` would read as "no charge".
   */
  it('reports an unpriced model as unknown rather than as free', () => {
    const cost = computeMediaCost({ kind: 'image', model: 'some-unknown-model', count: 2 });
    expect(cost.source).toBe('unknown');
    expect(cost.totalUsd).toBeUndefined();
  });

  it('uses the user price even when the built-in table also knows the model', () => {
    // gpt-image-2 is in the table at $0.04; the user says their contract is $0.01.
    expect(computeMediaCost({ kind: 'image', model: 'gpt-image-2', count: 2, userUnitPriceUsd: 0.01 })).toEqual({
      source: 'user',
      totalUsd: 0.02,
    });
  });
});

describe('meterMediaJob', () => {
  /**
   * Metered on what was produced, not what was asked for — this is the rule the
   * usage report applies, and the card must not apply a different one.
   */
  it('counts the assets that actually came back', () => {
    expect(meterMediaJob({ params: { n: 4 }, assets: [{}, {}] })).toEqual({ count: 2, durationSeconds: 0 });
  });

  it('prefers the requested duration and falls back to the asset it got', () => {
    expect(meterMediaJob({ params: { durationSeconds: 10 }, assets: [{ durationSeconds: 5 }] })).toEqual({
      count: 1,
      durationSeconds: 10,
    });
    expect(meterMediaJob({ params: {}, assets: [{ durationSeconds: 5 }] })).toEqual({
      count: 1,
      durationSeconds: 5,
    });
  });

  it('meters a job with no assets at nothing', () => {
    expect(meterMediaJob({})).toEqual({ count: 0, durationSeconds: 0 });
  });
});

describe('formatUsd', () => {
  /** Most single images land under a cent; 2 decimals would show them as free. */
  it('keeps sub-cent amounts visible', () => {
    expect(formatUsd(0.004)).toBe('$0.0040');
    expect(formatUsd(0.04)).toBe('$0.04');
    expect(formatUsd(1.5)).toBe('$1.50');
  });
});
