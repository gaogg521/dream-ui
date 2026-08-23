/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media generation entry point: resolve the catalog spec, clip parameters to
 * what the model supports, dispatch to the matching adapter, and normalize the
 * outcome text (paths only — never bytes).
 *
 * Called by the built-in MCP server today (in-process). In phase 2 this moves
 * behind the main-process MediaJobService without changing its contract.
 */

import type { TProviderWithModel } from '@/common/config/storage';
import { getMediaAdapter } from './adapters';
import { clipParamsToSpec, EXECUTABLE_FORMS, resolveMediaModelSpec } from './catalog/resolve';
import type { MediaGenOutcome, MediaGenParams, MediaKind, MediaProgressUpdate } from './types';

export type ExecuteMediaGenerationInput = {
  kind: MediaKind;
  prompt: string;
  params?: MediaGenParams;
  inputUris?: string[];
  provider: TProviderWithModel;
  workspaceDir: string;
  proxy?: string;
  signal?: AbortSignal;
  onProgress?: (update: MediaProgressUpdate) => void;
  /** Form C: resume an already-submitted remote task instead of submitting again. */
  resumeTaskId?: string;
  /** Form C: receives the remote task id as soon as it exists (persist it here). */
  onTaskSubmitted?: (taskId: string) => void;
};

/**
 * The most images one request may be expanded into.
 *
 * A ceiling is not optional here: this path is reachable by an agent through
 * the media MCP tool, and each extra image is a real charge. Nine matches the
 * highest count the vendor consoles themselves offer, so it is permissive
 * enough not to be felt while still bounding a runaway request.
 *
 * Shared with the parameter panel so the number the user is offered and the
 * number the executor will honor cannot drift apart.
 */
export const MAX_IMAGE_FAN_OUT = 9;

/**
 * Whether asking for more than one result may be turned into several requests.
 *
 * Images only, and only on the synchronous forms. A Form C job owns exactly one
 * remote task id — the whole resume-after-restart mechanism is built on that —
 * so splitting it into several tasks would leave a restart unable to say which
 * one it was waiting for. Video is excluded for the same reason and because a
 * second clip is a large, silent charge.
 */
const supportsFanOut = (kind: MediaKind, form: string, resumeTaskId?: string): boolean =>
  kind === 'image' && (form === 'A' || form === 'B') && !resumeTaskId;

/**
 * Run the request repeatedly until `total` results exist, and fold the results
 * into one outcome.
 *
 * Sequential on purpose. Each round is a separate charge, so checking the abort
 * signal between rounds means cancelling actually stops the spend rather than
 * merely hiding results already paid for. It also keeps the saved filenames —
 * which are timestamped — from being minted in the same millisecond.
 *
 * A failure ends the run rather than pressing on: whatever broke (a rate limit,
 * a rejected prompt, an expired key) will almost certainly break the next round
 * too, and paying to confirm that is not worth it. Results already in hand are
 * still returned.
 */
async function fanOut(
  runOnce: (n: number) => Promise<MediaGenOutcome>,
  total: number,
  perRequest: number,
  signal?: AbortSignal
): Promise<MediaGenOutcome> {
  const assets: MediaGenOutcome['assets'] = [];
  let last: MediaGenOutcome | undefined;
  let remaining = total;

  while (remaining > 0 && !signal?.aborted) {
    // The final round asks only for the remainder — a flat `perRequest` would
    // overshoot (9 wanted, 4 per request → 12 images, three of them unasked-for
    // and all three billed).
    const outcome = await runOnce(Math.min(perRequest, remaining));
    last = outcome;
    assets.push(...outcome.assets);
    if (!outcome.success) break;
    remaining -= Math.max(1, outcome.assets.length);
  }

  // Nothing came back at all: the single failure is the more useful answer.
  if (assets.length === 0) return last ?? { success: false, assets: [], text: '', error: 'no-result' };

  const shortfall = total - assets.length;
  return {
    ...last,
    success: true,
    assets,
    text:
      shortfall > 0
        ? `Generated ${assets.length} of ${total} requested images; the rest were not produced (${last?.error || 'cancelled'}).`
        : `Generated ${assets.length} images.`,
    error: undefined,
  };
}

export async function executeMediaGeneration(input: ExecuteMediaGenerationInput): Promise<MediaGenOutcome> {
  const { kind, prompt, provider, workspaceDir, proxy, signal, onProgress, resumeTaskId, onTaskSubmitted } = input;
  const requestedParams = input.params ?? {};
  const inputUris = input.inputUris ?? [];

  const spec = resolveMediaModelSpec(kind, provider, provider.use_model);

  // No catalog match → Form B fallback for images. This is the compatibility
  // net: any provider/model that worked before the catalog existed keeps
  // working exactly as it did.
  const form = spec?.form ?? (kind === 'image' ? 'B' : undefined);
  if (!form) {
    return {
      success: false,
      assets: [],
      text: `Error: model "${provider.use_model}" is not recognized as a ${kind} generation model. Select a supported model in Settings > Tools.`,
      error: 'unsupported-model',
    };
  }

  if (!EXECUTABLE_FORMS.includes(form)) {
    return {
      success: false,
      assets: [],
      text: `Error: model "${provider.use_model}" uses an async task API that is not supported yet (coming with the media job engine). Select a synchronous model in Settings > Tools for now.`,
      error: 'form-not-executable',
    };
  }

  const adapter = getMediaAdapter(form);
  if (!adapter) {
    return {
      success: false,
      assets: [],
      text: `Error: no adapter available for API form "${form}".`,
      error: 'no-adapter',
    };
  }

  const { params, dropped } = clipParamsToSpec(requestedParams, spec);

  /**
   * How many images one request actually returns.
   *
   * `maxN` is a property of the endpoint, not of the model: the gateway's
   * gpt-image honors `n` and returns that many, while Ark's Seedream ignores it
   * and returns one no matter what (measured — `n: 99` still answers with a
   * single image). Asking the second one for four images therefore has to mean
   * four requests.
   */
  const perRequest = Math.max(1, Math.trunc(params.n ?? 1));
  const requestedCount = Math.min(MAX_IMAGE_FAN_OUT, Math.max(1, Math.trunc(requestedParams.n ?? 1)));
  const willFanOut = supportsFanOut(kind, form, resumeTaskId) && requestedCount > perRequest;

  const runOnce = (n: number) =>
    adapter.generate({
      kind,
      prompt,
      params: n === perRequest ? params : { ...params, n },
      inputUris,
      provider,
      spec,
      workspaceDir,
      proxy,
      signal,
      onProgress,
      resumeTaskId,
      onTaskSubmitted,
    });

  const outcome = willFanOut ? await fanOut(runOnce, requestedCount, perRequest, signal) : await runOnce(perRequest);

  // `n` was clipped away per request, but the request as a whole honored it, so
  // reporting it as an ignored parameter would be false — and would teach an
  // agent not to ask for several images again.
  if (willFanOut) {
    const index = dropped.indexOf('n');
    if (index >= 0) dropped.splice(index, 1);
  }

  // Surface asset paths in the text (agent-facing contract: keep the
  // "Generated image saved to:" line existing prompts rely on) and report any
  // clipped parameters so agents don't retry them blindly.
  if (outcome.success && outcome.assets.length > 0) {
    const lines = outcome.assets.map((asset) => `Generated ${asset.kind} saved to: ${asset.filePath}`);
    outcome.text = `${outcome.text}\n\n${lines.join('\n')}`;
  }
  if (dropped.length > 0) {
    outcome.droppedParams = dropped;
    outcome.text = `${outcome.text}\n\nNote: parameter(s) ${dropped.join(', ')} are not supported by model "${provider.use_model}" and were ignored. Do not retry with these parameters.`;
  }

  return outcome;
}
