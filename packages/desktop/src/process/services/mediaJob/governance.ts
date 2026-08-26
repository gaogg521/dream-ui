/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Company policy gate for media generation.
 *
 * Chat sends pass through `SendGate` in the backend, but media reaches the
 * provider through the built-in MCP tool and never touched it — so the
 * priciest calls in the product ran outside both the spend cap and the model
 * allowlist. This module is the missing enforcement point, and it lives on the
 * main-process side of the job engine because that is the single place every
 * media call funnels through (the MCP shell cannot be trusted to gate itself).
 *
 * Personal / no-company users are unaffected: the backend answers `allow` for
 * them without consulting anything, which is the same red line every other
 * governance check honors.
 *
 * # Why this does not use `httpBridge`
 *
 * `httpBridge` decides local-vs-remote from renderer localStorage, which the
 * main process cannot read — so from here it always resolved to the local
 * backend. On a member's machine in enterprise client mode that backend has no
 * membership row, no licence and no budget, so the gate answered "allow" for
 * everyone and the usage report landed in a local file nobody reads. The spend
 * cap was, in the only deployment shape a company actually uses, decorative.
 *
 * `governanceFetch` uses the endpoint the renderer pushes down, which is how
 * the team-knowledge tool already reaches company data from this process.
 */

import { governanceFetch } from '@process/services/governanceEndpoint';
import type { MediaKind } from '@/common/media/types';

export type MediaPolicyDecision = { allow: boolean; reason?: string };

type PrecheckResponse = { allow?: boolean; reason?: string } | undefined;

/**
 * Ask the backend whether this generation may run.
 *
 * **Fails open on transport errors, and that is deliberate.** A refusal must
 * mean "policy said no", not "the request did not get through" — treating an
 * outage as a denial would take media generation down for every personal user
 * the moment this endpoint hiccups, to protect a policy most of them do not
 * have. Enforcement that matters is server-side anyway: the same backend owns
 * both the answer and the usage ledger.
 */
export async function checkMediaPolicy(kind: MediaKind, model: string): Promise<MediaPolicyDecision> {
  try {
    const response = await governanceFetch<PrecheckResponse>('POST', '/api/one/billing/media-precheck', {
      kind,
      model,
    });

    if (response && response.allow === false) {
      return { allow: false, reason: response.reason || 'Blocked by company policy.' };
    }
    return { allow: true };
  } catch {
    return { allow: true };
  }
}

/**
 * Report a finished generation so it lands in the company's spend rollup.
 *
 * Best-effort by design: the media is already produced and saved, so failing
 * the job over a bookkeeping call would throw away work the user paid for.
 */
export async function reportMediaUsage(
  kind: MediaKind,
  model: string,
  count: number,
  durationSeconds?: number,
  /**
   * The user's own price for this model, when they entered one. Sent so the
   * company rollup reflects what they are actually charged instead of our
   * built-in illustrative rate.
   */
  unitPriceUsd?: number,
  /**
   * Which conversation this generation belongs to, when the caller knows.
   *
   * Attribution only — no prompt, no asset path. What a company needs from the
   * ledger is "who spent this, and where", and the conversation id answers that
   * for both surfaces: the agent audit already lists the tool call, and a
   * compose-box generation writes no message at all, so this is the only trace
   * it leaves. Recording the prompt would be a content-retention decision, and
   * that is the admin's to make, not a default.
   */
  conversationId?: string
): Promise<void> {
  try {
    await governanceFetch('POST', '/api/one/billing/media-usage', {
      kind,
      model,
      count,
      durationSeconds: durationSeconds ?? 0,
      unitPriceMicros:
        typeof unitPriceUsd === 'number' && Number.isFinite(unitPriceUsd) && unitPriceUsd > 0
          ? Math.round(unitPriceUsd * 1_000_000)
          : undefined,
      conversationId: conversationId || undefined,
    });
  } catch {
    // Ignored on purpose — see above.
  }
}

/**
 * Record one generated FILE in the consolidated media ledger (T8) — distinct
 * from {@link reportMediaUsage} above, which is cost/attribution only and
 * carries neither a file path nor the prompt.
 *
 * Called once per produced asset, right after the usage report. The prompt is
 * always sent — the backend decides whether it is actually persisted based on
 * the company's own retention setting (off by default), never trusting this
 * caller to honor it. No-op for personal/no-company users, enforced
 * server-side.
 *
 * Best-effort by the same reasoning as `reportMediaUsage`: the file already
 * exists on disk, so a ledger-bookkeeping failure must not read as a failed
 * generation.
 */
export async function reportMediaAsset(
  kind: MediaKind,
  model: string,
  filePath: string,
  prompt: string,
  conversationId?: string
): Promise<void> {
  try {
    await governanceFetch('POST', '/api/one/billing/media-ledger/report', {
      kind,
      model,
      filePath,
      prompt: prompt || undefined,
      conversationId: conversationId || undefined,
    });
  } catch {
    // Ignored on purpose — see above.
  }
}
