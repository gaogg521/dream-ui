/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agnes AI video API (agnes-video-v2.0).
 *
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-v20 (fetched 2026-08-11)
 *
 * Fixed host independent of whatever `base_url` the provider's chat traffic
 * uses, like Kling — the docs hardcode `apihub.agnes-ai.com` for both create
 * and poll, there is no per-account/region variant documented.
 *
 * Submit: POST /v1/videos → { video_id, task_id, status: 'queued', ... }.
 * Poll (recommended): GET /agnesapi?video_id=<id> → status queued/in_progress/
 * completed/failed, final URL at `metadata.url`. `video_id` and `task_id` are
 * usually the same value; `video_id` is what the docs recommend for new
 * integrations, so `submit()` returns that as the driver's `taskId`.
 */

import {
  readJsonOrThrow,
  type TaskDriver,
  type TaskPollContext,
  type TaskPollResult,
  type TaskSubmitContext,
} from './types';

const API_ROOT = 'https://apihub.agnes-ai.com';

const headers = (apiKey: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
});

/**
 * `num_frames` must be ≤ 441 and follow the vendor's `8n + 1` rule; the docs'
 * own duration table (3s→81, 5s→121, 10s→241, 18s→441, all at 24fps) is this
 * same formula evaluated at round numbers. Frame rate is left fixed at the
 * vendor's recommended 24 — nothing in `MediaGenParams` carries a separate
 * frame-rate knob, and the vendor itself auto-normalizes odd combinations.
 */
const FRAME_RATE = 24;
const MAX_FRAMES = 441;

const framesForDuration = (seconds: number | undefined): number => {
  if (!seconds || seconds <= 0) return 121; // vendor's own "standard" default (~5s)
  const raw = seconds * FRAME_RATE;
  const n = Math.round((raw - 1) / 8);
  return Math.min(MAX_FRAMES, Math.max(1, n * 8 + 1));
};

/**
 * Width/height presets at the vendor's 720p tier, one per documented aspect
 * ratio. The vendor normalizes any submitted size to its nearest preset
 * anyway (`metadata.size_mapping`), so these only need to land close — exact
 * precision is the vendor's job, not this driver's.
 */
const SIZE_BY_ASPECT: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1152, height: 768 },
  '9:16': { width: 768, height: 1152 },
  '1:1': { width: 960, height: 960 },
  '4:3': { width: 1088, height: 816 },
  '3:4': { width: 816, height: 1088 },
};
const DEFAULT_SIZE = SIZE_BY_ASPECT['16:9'];

type AgnesTaskPayload = {
  status?: string;
  progress?: number;
  metadata?: { url?: string };
  error?: unknown;
};

const describeError = (error: unknown, fallback: string): string => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
};

export const agnesDriver: TaskDriver = {
  id: 'agnes-task',

  async submit(ctx: TaskSubmitContext): Promise<{ taskId: string }> {
    const reference = ctx.params.firstFrameImage || ctx.inputs[0];
    const size = (ctx.params.aspectRatio && SIZE_BY_ASPECT[ctx.params.aspectRatio]) || DEFAULT_SIZE;

    const body: Record<string, unknown> = {
      model: ctx.model,
      prompt: ctx.prompt,
      width: size.width,
      height: size.height,
      num_frames: framesForDuration(ctx.params.durationSeconds),
      frame_rate: FRAME_RATE,
    };
    if (reference) body.image = reference;
    if (ctx.params.seed !== undefined) body.seed = ctx.params.seed;
    if (ctx.params.negativePrompt) body.negative_prompt = ctx.params.negativePrompt;

    const response = await fetch(`${API_ROOT}/v1/videos`, {
      method: 'POST',
      headers: headers(ctx.apiKey),
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    const payload = await readJsonOrThrow(response, 'Agnes video submission');
    // `video_id` is the vendor-recommended handle for new integrations; `task_id`
    // is kept only as a fallback in case a deployment ever omits it.
    const taskId = (payload.video_id as string | undefined) || (payload.task_id as string | undefined);
    if (!taskId) {
      throw new Error(`Agnes video submission returned no video_id: ${JSON.stringify(payload).slice(0, 200)}`);
    }
    return { taskId };
  },

  async poll(ctx: TaskPollContext, taskId: string): Promise<TaskPollResult> {
    const response = await fetch(`${API_ROOT}/agnesapi?video_id=${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: headers(ctx.apiKey),
      signal: ctx.signal,
    });

    const payload = (await readJsonOrThrow(response, 'Agnes video poll')) as AgnesTaskPayload;

    switch (payload.status) {
      case 'queued':
        return { state: 'pending' };
      case 'in_progress':
        return { state: 'running', percent: typeof payload.progress === 'number' ? payload.progress : undefined };
      case 'completed': {
        const url = payload.metadata?.url;
        if (!url) {
          return { state: 'failed', error: 'Agnes reported completed but returned no metadata.url' };
        }
        return { state: 'succeeded', items: [{ url }] };
      }
      case 'failed':
        return { state: 'failed', error: describeError(payload.error, 'Agnes video task failed') };
      default:
        // Unknown status: keep polling rather than fail — the shared timeout
        // in taskPollAdapter is the backstop for a status the vendor never sends.
        return { state: 'running' };
    }
  },
};
