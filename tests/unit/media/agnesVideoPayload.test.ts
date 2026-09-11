/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Agnes video driver's two request shapes.
 *
 * `agnes-video-2.5-fast` failed every submission with
 *
 *     HTTP 400 {"code":"invalid_request","message":"width is a forbidden field"}
 *
 * while 2.0 worked. The driver was written against the 2.0 docs and sent the
 * pixel fields unconditionally; 2.5 replaced them with `aspect_ratio` + `size`
 * + `seconds` and rejects the old ones outright rather than ignoring them.
 *
 * These cases pin both shapes from the vendor's documented parameter tables, so
 * the fix cannot regress into "one payload that tries to satisfy both".
 *
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-v20
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-25
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-25-flash
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTaskDriver } from '@/common/media/adapters/taskDrivers';
import type { MediaModelSpec } from '@/common/media/catalog/types';
import type { TaskSubmitContext } from '@/common/media/adapters/taskDrivers/types';
import { resolveMediaModelSpec } from '@/common/media/catalog/resolve';

const spec = { id: 's', kind: 'video', form: 'C', match: { model: /x/ }, params: {} } as MediaModelSpec;

/** Every field 2.5 documents as rejected with HTTP 400. */
const FORBIDDEN_ON_V25 = ['width', 'height', 'fps', 'num_frames', 'quality', 'num_inference_steps'];

const submitAndCaptureBody = async (model: string, params: Record<string, unknown> = {}) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ video_id: 'video_1' }),
    text: async () => '{"video_id":"video_1"}',
  });
  vi.stubGlobal('fetch', fetchMock);

  const driver = getTaskDriver('agnes-task');
  expect(driver).toBeTruthy();
  await driver!.submit({
    kind: 'video',
    prompt: 'two beasts crossing their tribulation',
    params: params as TaskSubmitContext['params'],
    inputs: [],
    model,
    baseUrl: 'https://agnes-ai.com/v1',
    apiKey: 'k',
    spec,
  });

  const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
  return { url, body: JSON.parse(init.body) as Record<string, unknown> };
};

describe('Agnes video driver request shape', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['agnes-video-2.5', 'agnes-video-2.5-flash', 'agnes-video-2.5-fast'])(
    'sends the 2.5 shape for %s and none of the forbidden pixel fields',
    async (model) => {
      const { body } = await submitAndCaptureBody(model, { durationSeconds: 10, aspectRatio: '9:16' });

      expect(body.model).toBe(model);
      expect(body.mode).toBe('text');
      expect(body.seconds).toBe('10');
      expect(body.size).toBe('720P');
      expect(body.aspect_ratio).toBe('9:16');
      for (const field of FORBIDDEN_ON_V25) {
        expect(body, `${field} is rejected by 2.5 with HTTP 400`).not.toHaveProperty(field);
      }
    }
  );

  it('clamps a duration 2.0 allowed but 2.5 rejects', async () => {
    // 18s is a legal 2.0 duration and was offered in the picker; 2.5 caps at 12.
    const { body } = await submitAndCaptureBody('agnes-video-2.5-fast', { durationSeconds: 18 });
    expect(body.seconds).toBe('12');

    const short = await submitAndCaptureBody('agnes-video-2.5-fast', { durationSeconds: 1 });
    expect(short.body.seconds).toBe('4');
  });

  it('switches 2.5 to keyframe mode when there is a reference image', async () => {
    const { body } = await submitAndCaptureBody('agnes-video-2.5', {
      firstFrameImage: 'https://example.test/a.png',
    });

    expect(body.mode).toBe('keyframe');
    expect(body.first_frame).toBe('https://example.test/a.png');
    // `image` is the 2.0 spelling and is not a 2.5 field.
    expect(body).not.toHaveProperty('image');
  });

  it('drops negative_prompt on 2.5 rather than sending an undocumented field', async () => {
    // 2.5 has no negative-prompt parameter, and rejects unknown fields rather
    // than ignoring them — so sending it hopefully would fail the whole request.
    const { body } = await submitAndCaptureBody('agnes-video-2.5', { negativePrompt: 'blurry' });
    expect(body).not.toHaveProperty('negative_prompt');
  });

  it('leaves the 2.0 shape exactly as it was', async () => {
    const { body } = await submitAndCaptureBody('agnes-video-v2.0', {
      durationSeconds: 5,
      aspectRatio: '16:9',
      negativePrompt: 'blurry',
    });

    expect(body.width).toBe(1152);
    expect(body.height).toBe(768);
    expect(body.num_frames).toBe(121);
    expect(body.frame_rate).toBe(24);
    expect(body.negative_prompt).toBe('blurry');
    expect(body).not.toHaveProperty('mode');
    expect(body).not.toHaveProperty('seconds');
  });
});

/**
 * Which catalog entry a model resolves to decides what the picker offers, and
 * the two Agnes generations disagree about that. Resolution takes the FIRST
 * matching entry, and the generic `/agnes.*video/` pattern would swallow every
 * 2.5 model if it came first — handing 2.5 users an 18s option and a negative
 * prompt its API rejects.
 */
describe('Agnes video catalog routing', () => {
  const provider = { platform: 'openai', base_url: 'https://apihub.agnes-ai.com/v1', name: 'Agnes' };

  it.each(['agnes-video-2.5', 'agnes-video-2.5-flash', 'agnes-video-2.5-fast'])(
    'routes %s to the 2.5 entry, not the generic one',
    (model) => {
      const resolved = resolveMediaModelSpec('video', provider, model);
      expect(resolved?.id).toBe('agnes-video-25');
    }
  );

  it('keeps 2.0 on the original entry', () => {
    expect(resolveMediaModelSpec('video', provider, 'agnes-video-v2.0')?.id).toBe('agnes-video');
  });

  it('offers each generation only the durations and fields its API accepts', () => {
    const v25 = resolveMediaModelSpec('video', provider, 'agnes-video-2.5-fast');
    const v20 = resolveMediaModelSpec('video', provider, 'agnes-video-v2.0');

    // 2.5 caps at 12s and has no negative-prompt parameter at all.
    expect(v25?.params.durations?.every((d) => d >= 4 && d <= 12)).toBe(true);
    expect(v25?.params.negativePrompt).toBe(false);
    expect(v25?.params.aspectRatios).toContain('21:9');

    // 2.0 keeps its own table, 21:9 included nowhere.
    expect(v20?.params.durations).toContain(18);
    expect(v20?.params.negativePrompt).toBe(true);
    expect(v20?.params.aspectRatios).not.toContain('21:9');
  });
});
