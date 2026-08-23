/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { getTaskDriver, REGISTERED_DRIVER_IDS } from '@/common/media/adapters/taskDrivers';
import { buildKlingToken, parseKlingCredentials } from '@/common/media/adapters/taskDrivers/klingDriver';
import { IMPLEMENTED_ENDPOINT_STYLES } from '@/common/media/catalog/resolve';
import type { MediaModelSpec } from '@/common/media/catalog/types';
import type { TaskSubmitContext } from '@/common/media/adapters/taskDrivers/types';

const spec = { id: 's', kind: 'video', form: 'C', match: { model: /x/ }, params: {} } as MediaModelSpec;

const submitCtx = (over: Partial<TaskSubmitContext> = {}): TaskSubmitContext => ({
  kind: 'video',
  prompt: 'a cat surfing',
  params: {},
  inputs: [],
  model: 'm-1',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  spec,
  ...over,
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The picker gates on this list, so a driver that exists but is not declared
// (or vice versa) silently changes what users can select.
describe('driver registry', () => {
  it('agrees with the catalog gate', () => {
    expect([...REGISTERED_DRIVER_IDS].toSorted()).toEqual([...IMPLEMENTED_ENDPOINT_STYLES].toSorted());
  });

  it('resolves each declared style to a driver', () => {
    for (const style of IMPLEMENTED_ENDPOINT_STYLES) {
      expect(getTaskDriver(style), style).toBeDefined();
    }
  });
});

describe('openai-video driver', () => {
  const driver = getTaskDriver('openai-video')!;

  it('submits with the API spelling of duration and returns the task id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'video_123', status: 'queued' }));
    vi.stubGlobal('fetch', fetchMock);

    const { taskId } = await driver.submit(submitCtx({ params: { durationSeconds: 8, size: '1280x720' } }));

    expect(taskId).toBe('video_123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/videos');
    const body = JSON.parse(String(init.body));
    // `seconds`, as a string — not `duration`, not a number.
    expect(body.seconds).toBe('8');
    expect(body.size).toBe('1280x720');
  });

  // The finished video sits behind the same bearer token, so the result item
  // has to carry auth or the shared downloader gets a 401.
  it('returns the content endpoint with auth headers on completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: 'video_123', status: 'completed' }))
    );

    const result = await driver.poll(
      { kind: 'video', model: 'm-1', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', spec },
      'video_123'
    );

    expect(result.state).toBe('succeeded');
    if (result.state !== 'succeeded') return;
    expect(result.items[0].url).toBe('https://api.example.com/v1/videos/video_123/content');
    expect(result.items[0].headers).toEqual({ Authorization: 'Bearer sk-test' });
  });

  it('passes the vendor percentage through while running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'in_progress', progress: 42 }))
    );
    const result = await driver.poll(
      { kind: 'video', model: 'm', baseUrl: 'https://api.example.com/v1', apiKey: 'k', spec },
      't'
    );
    expect(result).toEqual({ state: 'running', percent: 42 });
  });
});

describe('cogvideox driver', () => {
  const driver = getTaskDriver('cogvideox')!;

  it('submits and reads the upper-case status vocabulary', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'task-9', task_status: 'PROCESSING' }));
    vi.stubGlobal('fetch', fetchMock);

    const { taskId } = await driver.submit(submitCtx());
    expect(taskId).toBe('task-9');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/v1/videos/generations');
  });

  it('polls a different path than it submitted to', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn/x.mp4' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await driver.poll(
      { kind: 'video', model: 'm', baseUrl: 'https://api.example.com/v1', apiKey: 'k', spec },
      'task-9'
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/v1/async-result/task-9');
    expect(result).toEqual({ state: 'succeeded', items: [{ url: 'https://cdn/x.mp4' }] });
  });

  it('reports a vendor failure with its message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ task_status: 'FAIL', message: 'content policy' }))
    );
    const result = await driver.poll(
      { kind: 'video', model: 'm', baseUrl: 'https://api.example.com/v1', apiKey: 'k', spec },
      't'
    );
    expect(result).toEqual({ state: 'failed', error: 'content policy' });
  });
});

describe('kling driver', () => {
  const driver = getTaskDriver('kling')!;
  const pollCtx = { kind: 'video' as const, model: 'm', baseUrl: 'https://api.klingai.com', apiKey: 'ak:sk', spec };

  it('accepts the credential pair in the shapes users paste', () => {
    expect(parseKlingCredentials('ak:sk')).toEqual({ accessKey: 'ak', secretKey: 'sk' });
    expect(parseKlingCredentials('ak|sk')).toEqual({ accessKey: 'ak', secretKey: 'sk' });
    expect(parseKlingCredentials('  ak   sk ')).toEqual({ accessKey: 'ak', secretKey: 'sk' });
    expect(parseKlingCredentials('onlyone')).toBeNull();
  });

  // Verified against an independent HMAC implementation: a token this vendor
  // rejects fails every call, and a hand-rolled signer is easy to get subtly
  // wrong (padding, url-safe alphabet, encoding of the signing input).
  it('signs a JWT that an independent HMAC verifies', async () => {
    const token = await buildKlingToken('my-ak', 'my-sk', 1_700_000_000_000);
    const [header, payload, signature] = token.split('.');

    const expected = crypto
      .createHmac('sha256', 'my-sk')
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(signature).toBe(expected);

    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decode(payload);
    expect(claims.iss).toBe('my-ak');
    expect(claims.exp).toBe(1_700_000_000 + 1800);
    // Backdated: the vendor rejects a not-before that is even slightly ahead.
    expect(claims.nbf).toBe(1_700_000_000 - 5);
  });

  it('refuses to call without both keys instead of sending a broken token', async () => {
    await expect(driver.submit(submitCtx({ apiKey: 'only-one', baseUrl: 'https://api.klingai.com' }))).rejects.toThrow(
      /access key and a secret key/
    );
  });

  it('routes to image2video when a reference frame is given', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ code: 0, data: { task_id: 'kt-1' } }));
    vi.stubGlobal('fetch', fetchMock);

    await driver.submit(
      submitCtx({ baseUrl: 'https://api.klingai.com', apiKey: 'ak:sk', params: { firstFrameImage: 'https://x/a.png' } })
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.klingai.com/v1/videos/image2video');

    fetchMock.mockClear();
    await driver.submit(submitCtx({ baseUrl: 'https://api.klingai.com', apiKey: 'ak:sk' }));
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.klingai.com/v1/videos/text2video');
  });

  // Kling reports business errors inside a 200 envelope, so HTTP status alone
  // would read as success.
  it('treats a non-zero code in a 200 response as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code: 1103, message: 'account arrears' }))
    );
    await expect(driver.submit(submitCtx({ baseUrl: 'https://api.klingai.com', apiKey: 'ak:sk' }))).rejects.toThrow(
      /account arrears/
    );
  });

  it('maps the task lifecycle', async () => {
    const states: Array<[string, string]> = [
      ['submitted', 'pending'],
      ['processing', 'running'],
    ];
    for (const [vendor, expected] of states) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse({ code: 0, data: { task_status: vendor } }))
      );
      expect((await driver.poll(pollCtx, 'kt-1')).state, vendor).toBe(expected);
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          code: 0,
          data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn/k.mp4' }] } },
        })
      )
    );
    expect(await driver.poll(pollCtx, 'kt-1')).toEqual({ state: 'succeeded', items: [{ url: 'https://cdn/k.mp4' }] });
  });
});

// verified: https://agnes-ai.com/zh-Hans/docs/agnes-video-v20 (fetched 2026-08-11) —
// request/response shapes below are quoted from that page, not guessed.
describe('agnes driver', () => {
  const driver = getTaskDriver('agnes-task')!;
  const pollCtx = {
    kind: 'video' as const,
    model: 'agnes-video-v2.0',
    baseUrl: 'https://irrelevant.example',
    apiKey: 'sk-test',
    spec,
  };

  it('submits to the fixed Agnes host regardless of the configured base_url', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ id: 'task_1', task_id: 'task_1', video_id: 'video_1', status: 'queued' })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { taskId } = await driver.submit(
      submitCtx({ model: 'agnes-video-v2.0', baseUrl: 'https://irrelevant.example', apiKey: 'sk-test' })
    );

    expect(taskId).toBe('video_1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://apihub.agnes-ai.com/v1/videos');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('agnes-video-v2.0');
    expect(body.prompt).toBe('a cat surfing');
    // Defaults land on the vendor's own "standard video generation" preset.
    expect(body.width).toBe(1152);
    expect(body.height).toBe(768);
    expect(body.num_frames).toBe(121);
    expect(body.frame_rate).toBe(24);
  });

  it('rounds a requested duration to the 8n+1 frame count the vendor requires', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ video_id: 'video_2', status: 'queued' }));
    vi.stubGlobal('fetch', fetchMock);

    await driver.submit(submitCtx({ model: 'agnes-video-v2.0', params: { durationSeconds: 10 } }));

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    // 10s * 24fps = 240 raw frames; nearest 8n+1 is 241 — matches the vendor's
    // own documented table (~10s → num_frames: 241, frame_rate: 24).
    expect(body.num_frames).toBe(241);
    expect(body.num_frames % 8).toBe(1);
  });

  it('sends the reference image and passes seed/negative_prompt through', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ video_id: 'video_3', status: 'queued' }));
    vi.stubGlobal('fetch', fetchMock);

    await driver.submit(
      submitCtx({
        model: 'agnes-video-v2.0',
        params: { firstFrameImage: 'https://x/a.png', seed: 42, negativePrompt: 'blurry' },
      })
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.image).toBe('https://x/a.png');
    expect(body.seed).toBe(42);
    expect(body.negative_prompt).toBe('blurry');
  });

  it('throws when the vendor answers without a video_id or task_id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'queued' }))
    );
    await expect(driver.submit(submitCtx({ model: 'agnes-video-v2.0' }))).rejects.toThrow(/returned no video_id/);
  });

  it('maps queued/in_progress/completed/failed to the shared task states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'queued' }))
    );
    expect(await driver.poll(pollCtx, 'video_1')).toEqual({ state: 'pending' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'in_progress', progress: 42 }))
    );
    expect(await driver.poll(pollCtx, 'video_1')).toEqual({ state: 'running', percent: 42 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          status: 'completed',
          metadata: { url: 'https://platform-outputs.agnes-ai.space/videos/agnes-video-v2.0/task_x.mp4' },
        })
      )
    );
    expect(await driver.poll(pollCtx, 'video_1')).toEqual({
      state: 'succeeded',
      items: [{ url: 'https://platform-outputs.agnes-ai.space/videos/agnes-video-v2.0/task_x.mp4' }],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: 'failed', error: { message: 'content policy' } }))
    );
    expect(await driver.poll(pollCtx, 'video_1')).toEqual({ state: 'failed', error: 'content policy' });
  });

  it('polls the recommended video_id endpoint, not the legacy task_id path', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'queued' }));
    vi.stubGlobal('fetch', fetchMock);

    await driver.poll(pollCtx, 'video_1');

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://apihub.agnes-ai.com/agnesapi?video_id=video_1');
  });
});
