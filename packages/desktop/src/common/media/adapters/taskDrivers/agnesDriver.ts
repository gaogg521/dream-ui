/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agnes AI video API — two request shapes behind one endpoint.
 *
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-v20 (fetched 2026-08-11)
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-25 (fetched 2026-09-11)
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-25-flash (fetched 2026-09-11)
 *
 * 2.0 is sized in pixels (`width`/`height`/`num_frames`/`frame_rate`). 2.5 and
 * 2.5-flash took those knobs away and replaced them with `aspect_ratio` + a
 * `size` tier + `seconds`, and they do not merely ignore the old fields — the
 * docs list `width`, `height`, `fps`, `num_frames`, `quality` and
 * `num_inference_steps` as rejected outright:
 *
 *     HTTP 400 {"code":"invalid_request","message":"width is a forbidden field"}
 *
 * which is exactly what this driver produced for every 2.5 request, because it
 * was written against 2.0 and sent the pixel fields unconditionally. 2.5 also
 * requires a `mode` (text / keyframe / reference) that 2.0 has no concept of,
 * so the payload branches by model family rather than trying to be one shape
 * that satisfies both.
 *
 * Fixed host independent of whatever `base_url` the provider's chat traffic
 * uses, like Kling — the docs hardcode `apihub.agnes-ai.com` for both create
 * and poll, there is no per-account/region variant documented.
 *
 * Submit: POST /v1/videos → { video_id, task_id, status: 'queued', ... }.
 * Poll (recommended): GET /agnesapi?video_id=<id> → status queued/in_progress/
 * completed/failed. `video_id` and `task_id` are usually the same value;
 * `video_id` is what the docs recommend for new integrations, so `submit()`
 * returns that as the driver's `taskId`.
 *
 * ⚠ The finished address is at the response's **top-level `url`**, not at
 * `metadata.url` as the docs state — measured against the live host on
 * 2026-08-27, where the completed task object has no `metadata` key at all.
 * See the `completed` branch in `poll` for the full payload shape.
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

/**
 * Matches `agnes-video-2.5`, `-2.5-flash`, and the `-2.5-fast` spelling seen on
 * live deployments. The family, not the exact id: the request shape is what
 * differs, and every 2.5 variant shares it.
 */
export const isAgnesV25 = (model: string): boolean => /agnes[-_]?video[-_]?2\.5/i.test(model);

/** Flash rejects anything but 720P; plain 2.5 accepts more, but nothing in
 *  `MediaGenParams` carries a resolution knob for this model, so both stay on
 *  the tier that is always valid. */
const V25_SIZE_TIER = '720P';

/** 2.5 takes `seconds` as a string, and the documented range is "4"-"12". The
 *  catalog offers only in-range durations, so this is the belt to that braces:
 *  a provider-supplied default or a stale saved value cannot reach the API as
 *  an 18 that 2.0 allowed and 2.5 rejects. */
const V25_MIN_SECONDS = 4;
const V25_MAX_SECONDS = 12;
const v25Seconds = (seconds: number | undefined): string => {
  if (!seconds || seconds <= 0) return '5'; // the vendor's own default
  return String(Math.min(V25_MAX_SECONDS, Math.max(V25_MIN_SECONDS, Math.round(seconds))));
};

type AgnesTaskPayload = {
  status?: string;
  progress?: number;
  /** Where the live API puts the finished video. See the `completed` branch. */
  url?: string;
  /** What the docs say. Kept as a fallback. */
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
    const body: Record<string, unknown> = { model: ctx.model, prompt: ctx.prompt };

    if (isAgnesV25(ctx.model)) {
      // `mode` is required and decides which reference fields are legal:
      // `keyframe` takes first_frame/last_frame, `text` takes none. Only the
      // documented fields go on the wire — 2.5 rejects unknown ones rather
      // than ignoring them, so `negative_prompt` (a 2.0 field with no 2.5
      // counterpart) is deliberately dropped instead of sent hopefully.
      body.mode = reference ? 'keyframe' : 'text';
      body.seconds = v25Seconds(ctx.params.durationSeconds);
      body.size = V25_SIZE_TIER;
      body.aspect_ratio = ctx.params.aspectRatio || '16:9';
      if (reference) body.first_frame = reference;
      if (ctx.params.seed !== undefined) body.seed = ctx.params.seed;
    } else {
      const size = (ctx.params.aspectRatio && SIZE_BY_ASPECT[ctx.params.aspectRatio]) || DEFAULT_SIZE;
      body.width = size.width;
      body.height = size.height;
      body.num_frames = framesForDuration(ctx.params.durationSeconds);
      body.frame_rate = FRAME_RATE;
      if (reference) body.image = reference;
      if (ctx.params.seed !== undefined) body.seed = ctx.params.seed;
      if (ctx.params.negativePrompt) body.negative_prompt = ctx.params.negativePrompt;
    }

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
    // 2.5 documents `video_id + model_name` as the recommended lookup; 2.0's
    // page documents `video_id` alone. Sending the model only where it is
    // documented keeps 2.0 on the exact request that has been working.
    const pollQuery = isAgnesV25(ctx.model)
      ? `video_id=${encodeURIComponent(taskId)}&model_name=${encodeURIComponent(ctx.model)}`
      : `video_id=${encodeURIComponent(taskId)}`;
    const response = await fetch(`${API_ROOT}/agnesapi?${pollQuery}`, {
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
        /**
         * Top-level `url` first — that is where the live API actually puts it.
         *
         * The docs say `metadata.url`, and this driver believed them; measured
         * against `apihub.agnes-ai.com` on 2026-08-27 the completed task object
         * has no `metadata` key at all and carries the address at the top level
         * (`url: https://platform-outputs.agnes-ai.space/videos/<model>/<id>.mp4`),
         * alongside `status`/`progress`/`size`/`perf_*`. Reading only
         * `metadata.url` failed every completed generation with "returned no
         * metadata.url" — after the video had been produced and paid for.
         *
         * This went unnoticed because it was unreachable: `agnes-task` had no
         * catalog entry, so an Agnes video model resolved to null and was
         * hidden from the picker (see `videoModels.ts`). The two bugs concealed
         * each other; fixing the catalog is what exposed this one.
         *
         * `metadata.url` is kept as a fallback rather than replaced: it costs
         * one `??` and covers a deployment that does answer the documented way.
         */
        const url = payload.url || payload.metadata?.url;
        if (!url) {
          return {
            state: 'failed',
            // Name both places we looked, and show what came back — the old
            // message named one field and dropped the payload, which is why
            // this took a real generation to diagnose.
            error: `Agnes reported completed but returned no video URL (checked \`url\` and \`metadata.url\`): ${JSON.stringify(payload).slice(0, 300)}`,
          };
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
