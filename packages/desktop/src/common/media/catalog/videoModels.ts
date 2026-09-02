/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in video model catalog.
 *
 * All video generation in the wild is Form C (submit + poll). These entries
 * carry real protocol data now so phase 3 only wires drivers — but nothing
 * here is selectable or executable until 'C' enters EXECUTABLE_FORMS and the
 * video tool ships. Keeping the data adjacent to the image catalog is part of
 * the "build the base layer complete" decision (progress doc, 2026-08-05).
 */

import type { MediaModelSpec } from './types';

export const BUILTIN_VIDEO_MODELS: MediaModelSpec[] = [
  {
    // ByteDance Seedance on Volcano Ark (contents/generations/tasks).
    id: 'ark-seedance',
    kind: 'video',
    form: 'C',
    endpointStyle: 'ark-task',
    match: { model: /seedance/i },
    params: {
      durations: [5, 10],
      resolutions: ['480p', '720p', '1080p'],
      // `adaptive` lets the model pick the framing; verified accepted by a real
      // Seedance deployment, and it is what that vendor's own console defaults
      // to. Listed last so an explicit ratio still reads as the normal choice.
      aspectRatios: ['16:9', '9:16', '4:3', '1:1', '21:9', 'adaptive'],
      imageToVideo: true,
      firstLastFrame: true,
      seed: true,
      audio: true,
    },
    // Seedance ships silent video unless `generate_audio` is sent; users almost
    // always expect sound, so default it on and let an explicit "no audio" win.
    defaults: { durationSeconds: 5, resolution: '720p', generateAudio: true },
    polling: { intervalMs: 5000, timeoutMs: 600_000 },
  },
  {
    // Tongyi WanX video on DashScope (video-generation task API).
    id: 'dashscope-wanx-video',
    kind: 'video',
    form: 'C',
    endpointStyle: 'dashscope-task',
    match: { model: /^wan(x|2).*(t2v|i2v|video)/i },
    params: {
      durations: [5],
      resolutions: ['480p', '720p', '1080p'],
      imageToVideo: true,
      seed: true,
      negativePrompt: true,
    },
    defaults: { durationSeconds: 5, resolution: '720p' },
    polling: { intervalMs: 5000, timeoutMs: 600_000 },
  },
  {
    // Kling video (JWT-signed task API) — driver lands with phase 3.
    id: 'kling-video',
    kind: 'video',
    form: 'C',
    endpointStyle: 'kling',
    match: { model: /kling/i },
    params: {
      durations: [5, 10],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      imageToVideo: true,
      cameras: ['none', 'horizontal', 'vertical', 'pan', 'tilt', 'roll', 'zoom'],
    },
    defaults: { durationSeconds: 5, resolution: '720p' },
    polling: { intervalMs: 5000, timeoutMs: 600_000 },
  },
  {
    // OpenAI Sora-style /v1/videos task API.
    id: 'openai-video',
    kind: 'video',
    form: 'C',
    endpointStyle: 'openai-video',
    match: { model: /^sora/i },
    params: {
      durations: [4, 8, 12],
      sizes: ['1280x720', '720x1280', '1024x1792', '1792x1024'],
      imageToVideo: true,
    },
    defaults: { durationSeconds: 4 },
    polling: { intervalMs: 5000, timeoutMs: 600_000 },
  },
  {
    // Zhipu CogVideoX async task API.
    id: 'cogvideox',
    kind: 'video',
    form: 'C',
    endpointStyle: 'cogvideox',
    match: { model: /cogvideox/i },
    params: {
      durations: [5, 10],
      resolutions: ['720p', '1080p', '4k'],
      imageToVideo: true,
    },
    defaults: { durationSeconds: 5, resolution: '1080p' },
    polling: { intervalMs: 5000, timeoutMs: 600_000 },
  },
  {
    /**
     * Agnes AI video (`POST /v1/videos` + `GET /agnesapi`).
     *
     * `agnes-task` was the only implemented driver with no catalog entry, which
     * made an Agnes video model unreachable in practice: video deliberately
     * refuses to guess an endpoint style (`specFromDeclaration`), so declaring
     * the model as video resolved to `null` and `isMediaGenSupported` then hid
     * it from the picker entirely — with nothing telling the user that picking
     * `agnes-task` by hand in model settings was all it needed.
     *
     * Pinned to the vendor host on purpose, unlike the name-only entries above.
     * Two reasons, and they point the same way:
     *
     * - The driver ignores `base_url` completely and always calls
     *   `apihub.agnes-ai.com` (the docs hardcode it). Matching on the name
     *   alone would send an Agnes-named model served by some relay gateway
     *   straight past that gateway to the vendor, with the gateway's key — a
     *   worse failure than not resolving, because the request leaves.
     * - Name-only matching for a host-fixed protocol is exactly the shape that
     *   broke Seedance behind a relay gateway (see `endpointFallbacks.ts`), and
     *   `agnes-task` has no sibling protocol to fall back to.
     *
     * So a gateway-served Agnes model still resolves to nothing and still needs
     * an explicit `media_endpoint` — correct, since only the user knows what
     * their gateway speaks. This entry fixes the case that is unambiguous: the
     * provider points at Agnes itself.
     *
     * No `resolutions`: the driver has no resolution knob. It derives
     * width/height from `aspectRatio` at the vendor's 720p tier and lets the
     * vendor normalize, so offering a resolution list would offer a choice that
     * goes nowhere. Durations are the vendor's own documented table (24fps,
     * `8n + 1` frames).
     */
    id: 'agnes-video',
    kind: 'video',
    form: 'C',
    endpointStyle: 'agnes-task',
    match: { model: /agnes.*video|video.*agnes/i, baseUrlIncludes: ['agnes-ai.com'] },
    params: {
      durations: [3, 5, 10, 18],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      imageToVideo: true,
      seed: true,
      negativePrompt: true,
    },
    defaults: { durationSeconds: 5, aspectRatio: '16:9' },
    polling: { intervalMs: 5000, timeoutMs: 600_000 },
  },
];
