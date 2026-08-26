/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Ark task driver against a real captured exchange.
 *
 * Every other Ark test drives a fake server shaped the way we believe Ark
 * replies. These payloads are the genuine article — captured from the user's
 * own Seedance test bench on 2026-08-05, submit through succeeded — so they
 * are the only evidence that the field names the driver reads are the field
 * names Ark actually sends. Video has never completed end to end inside the
 * app (the configured gateway does not proxy the task API at all), which is
 * exactly why the wire contract needs pinning here rather than at runtime.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { getTaskDriver } from '@/common/media/adapters/taskDrivers';
import type { MediaModelSpec } from '@/common/media/catalog/types';
import type { TaskPollContext, TaskSubmitContext } from '@/common/media/adapters/taskDrivers/types';

const spec = { id: 's', kind: 'video', form: 'C', match: { model: /x/ }, params: {} } as MediaModelSpec;

const ARK_ROOT = 'https://ark.cn-beijing.volces.com/api/v3';

/** Verbatim `--- createVideo ---` response. */
const REAL_SUBMIT_RESPONSE = { id: 'cgt-20260805222313-tstr7' };

/** Verbatim `--- poll ---` response while the task is still working. */
const REAL_RUNNING_POLL = {
  id: 'cgt-20260805222313-tstr7',
  model: 'doubao-seedance-2-0-260128',
  status: 'running',
  error: null,
  created_at: 1785939793,
  updated_at: 1785939793,
  content: null,
  seed: 0,
  resolution: '',
  ratio: '',
  duration: 0,
  frames: null,
  framespersecond: 0,
  fileformat: null,
  generate_audio: true,
  revised_prompt: null,
  draft: false,
  draft_task_id: null,
  subdivisionlevel: null,
  service_tier: 'default',
  execution_expires_after: 172800,
  _request_id: '',
  safety_identifier: '',
  usage: { completion_tokens: 0, total_tokens: 0, tool_usage: { web_search: 0 } },
};

/** Verbatim final `--- poll ---` response. */
const REAL_SUCCEEDED_POLL = {
  ...REAL_RUNNING_POLL,
  status: 'succeeded',
  updated_at: 1785940029,
  content: {
    video_url:
      'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0/0217859397935100000.mp4?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Expires=86400',
    last_frame_url: null,
  },
  seed: 16656,
  resolution: '720p',
  ratio: '16:9',
  duration: 5,
  framespersecond: 24,
  usage: { completion_tokens: 108900, total_tokens: 108900, tool_usage: { web_search: 0 } },
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const submitCtx = (): TaskSubmitContext => ({
  kind: 'video',
  prompt: '一只小猫在草地上玩耍',
  params: { resolution: '720p', durationSeconds: 5 },
  inputs: [],
  model: 'seedance-2-0-pro',
  baseUrl: ARK_ROOT,
  apiKey: 'sk-test',
  spec,
});

const pollCtx = (): TaskPollContext => ({
  baseUrl: ARK_ROOT,
  apiKey: 'sk-test',
  model: 'seedance-2-0-pro',
  spec,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('arkDriver against the captured Seedance exchange', () => {
  const driver = () => {
    const d = getTaskDriver('ark-task');
    if (!d) throw new Error('ark-task driver is not registered');
    return d;
  };

  it('reads the task id out of the real submit response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(REAL_SUBMIT_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);

    const { taskId } = await driver().submit(submitCtx());

    expect(taskId).toBe('cgt-20260805222313-tstr7');
    // Ark's own root already carries `/api/v3`, so it must be left alone.
    expect(fetchMock.mock.calls[0][0]).toBe(`${ARK_ROOT}/contents/generations/tasks`);
  });

  it('treats the real running poll as still working, not as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(REAL_RUNNING_POLL)));

    // `error: null` rides along on every running poll; reading it as a failure
    // signal would abort a task that is merely still going.
    expect(await driver().poll(pollCtx(), 'cgt-20260805222313-tstr7')).toEqual({ state: 'running' });
  });

  it('extracts the video url from the real succeeded poll', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(REAL_SUCCEEDED_POLL)));

    const result = await driver().poll(pollCtx(), 'cgt-20260805222313-tstr7');

    expect(result.state).toBe('succeeded');
    expect(result.items?.[0]?.url).toBe(REAL_SUCCEEDED_POLL.content.video_url);
    // `last_frame_url` is null here and must not become a second bogus asset.
    expect(result.items).toHaveLength(1);
  });

  it('polls the task id back on the same versioned path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(REAL_RUNNING_POLL));
    vi.stubGlobal('fetch', fetchMock);

    await driver().poll(pollCtx(), 'cgt-20260805222313-tstr7');

    expect(fetchMock.mock.calls[0][0]).toBe(`${ARK_ROOT}/contents/generations/tasks/cgt-20260805222313-tstr7`);
  });
});
