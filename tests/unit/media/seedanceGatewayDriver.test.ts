/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pinned against a request the user ran successfully against the real gateway.
 *
 * Every URL, method and field below is copied from that working script rather
 * than inferred, because the whole reason this driver exists is that the
 * obvious guesses were all wrong: the routes are not under `/v1`, polling is a
 * POST with a body instead of a GET on the id, and the generation options are
 * JSON fields instead of Ark's `--flag` prompt suffixes. A regression on any of
 * those looks like "video silently never works", which is expensive to
 * rediscover.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedanceGatewayDriver } from '@/common/media/adapters/taskDrivers/seedanceGatewayDriver';
import { getTaskDriver, REGISTERED_DRIVER_IDS } from '@/common/media/adapters/taskDrivers';
import { IMPLEMENTED_ENDPOINT_STYLES, resolveMediaModelSpec } from '@/common/media/catalog';

const BASE = 'https://gateway.example.com';

const ctx = {
  kind: 'video' as const,
  model: 'seedance-2-0-fast',
  baseUrl: BASE,
  apiKey: 'sk-test',
  spec: { id: 'x', kind: 'video' as const, form: 'C' as const, match: { model: 'x' }, params: {} },
};

const submitCtx = (params: Record<string, unknown> = {}) => ({
  ...ctx,
  prompt: '一只小猫在天空飞翔',
  params,
  inputs: [] as string[],
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('seedanceGatewayDriver.submit', () => {
  it('posts the exact route and body shape the gateway accepts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'cgt-20260806174433-tpjbp' }));

    const result = await seedanceGatewayDriver.submit(
      submitCtx({ resolution: '480p', aspectRatio: 'adaptive', durationSeconds: 5, generateAudio: true })
    );

    expect(result).toEqual({ taskId: 'cgt-20260806174433-tpjbp' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/seedance/createVideo`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      model: 'seedance-2-0-fast',
      content: [{ type: 'text', text: '一只小猫在天空飞翔' }],
      resolution: '480p',
      ratio: 'adaptive',
      duration: 5,
      generate_audio: true,
    });
  });

  /**
   * Ark decorates the prompt with `--resolution 480p --dur 5`. Sending that
   * here would put the flags into the scene the model renders.
   */
  it('keeps generation options out of the prompt text', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'cgt-1' }));
    await seedanceGatewayDriver.submit(submitCtx({ resolution: '720p', durationSeconds: 10 }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content[0].text).toBe('一只小猫在天空飞翔');
    expect(body.content[0].text).not.toMatch(/--/);
  });

  /** The gateway has its own defaults; sending invented ones would override them. */
  it('omits every option the caller did not choose', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'cgt-1' }));
    await seedanceGatewayDriver.submit(submitCtx());
    expect(Object.keys(JSON.parse(fetchMock.mock.calls[0][1].body)).toSorted()).toEqual(['content', 'model']);
  });

  it('sends generate_audio: false when the user turned audio off', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'cgt-1' }));
    await seedanceGatewayDriver.submit(submitCtx({ generateAudio: false }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generate_audio).toBe(false);
  });

  it('carries a reference image as the first frame', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'cgt-1' }));
    await seedanceGatewayDriver.submit({ ...submitCtx(), inputs: ['https://x/ref.png'] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://x/ref.png' },
      role: 'first_frame',
    });
  });

  it('fails loudly when no id comes back', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'nope' }));
    await expect(seedanceGatewayDriver.submit(submitCtx())).rejects.toThrow(/returned no id/);
  });
});

describe('seedanceGatewayDriver.poll', () => {
  /** A GET on the id — the obvious shape, and the wrong one — returns nothing here. */
  it('polls with a POST carrying both the id and the model', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'running' }));
    await seedanceGatewayDriver.poll(ctx, 'cgt-20260806174433-tpjbp');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/seedance/getVideoResult`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ id: 'cgt-20260806174433-tpjbp', model: 'seedance-2-0-fast' });
  });

  it('reads the finished video out of content.video_url', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status: 'succeeded', content: { video_url: 'https://cdn/x.mp4' }, error: null })
    );
    expect(await seedanceGatewayDriver.poll(ctx, 'cgt-1')).toEqual({
      state: 'succeeded',
      items: [{ url: 'https://cdn/x.mp4' }],
    });
  });

  it('treats every terminal failure state as failed, with the reason', async () => {
    for (const status of ['failed', 'cancelled', 'expired']) {
      fetchMock.mockResolvedValue(jsonResponse({ status, error: { message: 'quota exhausted' } }));
      expect(await seedanceGatewayDriver.poll(ctx, 'cgt-1')).toEqual({
        state: 'failed',
        error: 'quota exhausted',
      });
    }
  });

  /**
   * The script's own loop keeps waiting on anything that is not terminal. An
   * unknown status must not abandon a task that is already paid for.
   */
  it('keeps waiting on a status it does not recognize', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'preparing' }));
    expect(await seedanceGatewayDriver.poll(ctx, 'cgt-1')).toEqual({ state: 'running' });
  });

  it('does not mistake a success with no video for a finished job', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'succeeded', content: {} }));
    expect(await seedanceGatewayDriver.poll(ctx, 'cgt-1')).toEqual({
      state: 'failed',
      error: 'Seedance reported success but returned no video',
    });
  });
});

describe('seedanceGatewayDriver.cancel', () => {
  it('deletes by id with the model in the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await seedanceGatewayDriver.cancel?.(ctx, 'cgt-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/api/seedance/task/cgt-1?model=seedance-2-0-fast`);
    expect(init.method).toBe('DELETE');
  });
});

describe('wiring', () => {
  it('is registered and selectable', () => {
    expect(getTaskDriver('seedance-gateway')).toBe(seedanceGatewayDriver);
    expect(REGISTERED_DRIVER_IDS).toContain('seedance-gateway');
    expect(IMPLEMENTED_ENDPOINT_STYLES).toContain('seedance-gateway');
  });

  /**
   * The point of shipping this as a declarable endpoint rather than a catalog
   * entry keyed on a hostname: the gateway is one company's internal address,
   * and hardcoding it would put someone's private host in the product.
   */
  it('lets a user point a catalogued model at this gateway instead of Ark', () => {
    const provider = {
      base_url: BASE,
      model_settings: { 'seedance-2-0-fast': { model_kind: 'video', media_endpoint: 'seedance-gateway' } },
    };
    const spec = resolveMediaModelSpec('video', provider, 'seedance-2-0-fast');
    expect(spec?.endpointStyle).toBe('seedance-gateway');
    // …while keeping the catalog's parameter knowledge for that model family.
    expect(spec?.params.durations).toEqual([5, 10]);
    expect(spec?.params.audio).toBe(true);
    expect(spec?.params.aspectRatios).toContain('adaptive');
  });

  it('still resolves to Ark when the user declared nothing', () => {
    const spec = resolveMediaModelSpec('video', { base_url: BASE, model_settings: {} }, 'seedance-2-0-pro');
    expect(spec?.endpointStyle).toBe('ark-task');
  });
});
