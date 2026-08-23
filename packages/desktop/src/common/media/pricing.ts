/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a generation costs — the number the user is shown, and the number the
 * company is billed, computed the same way.
 *
 * Media spend was invisible from both ends: nothing said what a request would
 * cost before sending it, and nothing said what it had cost afterwards. The
 * company ledger knew (`/api/one/billing/media-usage`), the person spending the
 * money did not.
 *
 * **This file mirrors a Rust implementation and must not drift from it.**
 * `1oneCore/crates/aionui-common/src/license.rs` owns the built-in rate table
 * and `estimate_media_cost_micros`; `one-billing/src/service.rs::record_media_usage`
 * owns the user-price branch. Showing a different number here than the one the
 * ledger records would be worse than showing nothing — the user would reconcile
 * against their invoice and find our figure wrong. The rate-table tests pin the
 * exact values asserted on the Rust side, so a change there fails here.
 *
 * Renderer-safe: no Node.js imports.
 */

import type { MediaGenParams, MediaKind } from './types';

/** Where the unit price came from. Drives how the figure may be labelled. */
export type MediaCostSource =
  /** The user's own price for this model — their actual contract. */
  | 'user'
  /** Our built-in table — a coarse illustration, must be shown as an estimate. */
  | 'builtin'
  /** No price for this model anywhere. Show no number rather than a wrong one. */
  | 'unknown';

export type MediaCost = {
  source: MediaCostSource;
  /** Total in USD. Absent when `source` is `'unknown'`. */
  totalUsd?: number;
};

/**
 * The units one job consumes.
 *
 * Video is metered per second *per asset*, not per clip — two 5-second clips
 * cost the same as one 10-second one. This mirrors `record_media_usage`.
 */
export type MediaUsageUnits = { count: number; durationSeconds: number };

/**
 * A job's duration when it did not declare one.
 *
 * Matches the Rust default: treating a missing duration as free would make the
 * priciest thing the product can do meter at zero.
 */
const DEFAULT_VIDEO_SECONDS = 5;

const MICROS_PER_USD = 1_000_000;

/** Mirror of `image_rate_micros` — per-image cost in USD-micros. */
const imageRateMicros = (model: string): number => {
  const m = model.toLowerCase();
  if (m.includes('gpt-image') || m.includes('dall-e-3')) return 40_000;
  if (m.includes('seedream') || m.includes('jimeng')) return 20_000;
  if (m.includes('flux') || m.includes('stable-diffusion') || m.includes('sd3')) return 10_000;
  if (m.includes('wanx') || m.includes('cogview') || m.includes('dall-e')) return 15_000;
  // Chat-multimodal image models (gemini image-preview and friends).
  if (m.includes('image') || m.includes('imagine') || m.includes('banana')) return 10_000;
  return 0;
};

/** Mirror of `video_rate_micros_per_second` — per-second cost in USD-micros. */
const videoRateMicrosPerSecond = (model: string): number => {
  const m = model.toLowerCase();
  if (m.includes('sora') || m.includes('veo')) return 500_000;
  if (m.includes('seedance') || m.includes('kling')) return 200_000;
  if (m.includes('wan') || m.includes('cogvideox') || m.includes('vidu')) return 100_000;
  return 0;
};

/**
 * Billable units for a request, mirroring both metering branches in the Rust.
 *
 * Exported so the job card and the pre-send estimate cannot disagree about what
 * "one generation" means.
 */
export const billableUnits = (kind: MediaKind, count: number, durationSeconds: number): number => {
  const safeCount = Math.max(0, Math.trunc(count));
  if (kind !== 'video') return safeCount;
  const seconds = durationSeconds > 0 ? durationSeconds : DEFAULT_VIDEO_SECONDS;
  return safeCount * seconds;
};

/** Mirror of `estimate_media_cost_micros`. Unknown models return 0. */
export const estimateMediaCostMicros = (
  kind: MediaKind,
  model: string,
  count: number,
  durationSeconds: number
): number => {
  const safeCount = Math.max(0, Math.trunc(count));
  if (kind === 'video') {
    const seconds = durationSeconds > 0 ? durationSeconds : DEFAULT_VIDEO_SECONDS;
    return safeCount * seconds * videoRateMicrosPerSecond(model);
  }
  return safeCount * imageRateMicros(model);
};

/**
 * What this generation costs.
 *
 * A price the user entered for their own provider beats the built-in table —
 * the table is a coarse illustration, theirs is the contract they are actually
 * billed under. Same precedence the ledger applies, deliberately.
 */
export const computeMediaCost = (input: {
  kind: MediaKind;
  model: string;
  count: number;
  durationSeconds?: number;
  /** The user's price per image, or per second of video. */
  userUnitPriceUsd?: number;
}): MediaCost => {
  const { kind, model, count, durationSeconds = 0, userUnitPriceUsd } = input;

  if (typeof userUnitPriceUsd === 'number' && Number.isFinite(userUnitPriceUsd) && userUnitPriceUsd > 0) {
    const units = billableUnits(kind, count, durationSeconds);
    return { source: 'user', totalUsd: (units * Math.round(userUnitPriceUsd * MICROS_PER_USD)) / MICROS_PER_USD };
  }

  const micros = estimateMediaCostMicros(kind, model, count, durationSeconds);
  // Zero here means "no rate for this model", not "free". Saying a paid
  // generation cost nothing is the one wrong answer worth avoiding outright.
  if (micros <= 0) return { source: 'unknown' };
  return { source: 'builtin', totalUsd: micros / MICROS_PER_USD };
};

/**
 * What a finished job actually consumed.
 *
 * Metered on what was produced rather than what was asked for: a job that
 * returns two of four requested images cost two. Shared with the main process's
 * usage report so the figure on the card is the figure in the ledger.
 */
export const meterMediaJob = (job: {
  params?: MediaGenParams;
  assets?: { durationSeconds?: number }[];
}): MediaUsageUnits => ({
  count: job.assets?.length ?? 0,
  durationSeconds: job.params?.durationSeconds ?? job.assets?.[0]?.durationSeconds ?? 0,
});

/**
 * Format a USD amount for display.
 *
 * Sub-cent amounts are the common case for images, so a plain 2-decimal format
 * would round most single generations to `$0.00` — which reads as free.
 */
export const formatUsd = (usd: number): string => {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};
