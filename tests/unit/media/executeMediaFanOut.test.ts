/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Asking for several images when the endpoint only ever returns one.
 *
 * Measured against the real APIs on 2026-08-07: the gateway's gpt-image honors
 * `n` and returns that many in one response, while Ark's Seedream answers `n: 2`
 * — and `n: 99` — with a single image and bills a single generation. So "four
 * images" cannot mean one request for every model, and the count the user picks
 * has to survive that difference.
 *
 * These charge real money per round, which is why the accounting (how many
 * rounds, how large, and when to stop) is asserted here rather than trusted.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaGenOutcome } from '@/common/media/types';

const generate = vi.fn();
vi.mock('@/common/media/adapters', () => ({ getMediaAdapter: () => ({ generate }) }));

const { executeMediaGeneration, MAX_IMAGE_FAN_OUT } = await import('@/common/media/executeMediaGeneration');

/** An outcome carrying `count` distinct assets, as a real adapter would. */
const ok = (count: number): MediaGenOutcome => ({
  success: true,
  assets: Array.from({ length: count }, (_, i) => ({
    kind: 'image' as const,
    filePath: `D:\\ws\\img-${generate.mock.calls.length}-${i}.png`,
    relativePath: `img-${generate.mock.calls.length}-${i}.png`,
    mimeType: 'image/png',
  })),
  text: 'done',
});

const seedream = {
  platform: 'custom',
  base_url: 'https://ark.cn-beijing.volces.com/api/v3',
  use_model: 'doubao-seedream-5-0-pro',
  api_key: 'k',
};
const gptImage = { platform: 'custom', base_url: 'https://gw.example.com', use_model: 'gpt-image-2', api_key: 'k' };

const run = (provider: unknown, params: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  executeMediaGeneration({
    kind: 'image',
    prompt: 'a red bicycle',
    params,
    provider: provider as never,
    workspaceDir: 'D:\\ws',
    ...over,
  } as never);

beforeEach(() => {
  generate.mockReset();
  generate.mockImplementation(() => Promise.resolve(ok(1)));
});

describe('image fan-out', () => {
  it('issues one request per image when the endpoint returns one at a time', async () => {
    const outcome = await run(seedream, { n: 3 });

    expect(generate).toHaveBeenCalledTimes(3);
    expect(outcome.assets).toHaveLength(3);
    expect(outcome.success).toBe(true);
  });

  /**
   * The images must differ. Reusing one response three times would satisfy a
   * count assertion while giving the user the same picture three times.
   */
  it('returns distinct assets rather than the same one repeated', async () => {
    const outcome = await run(seedream, { n: 3 });
    expect(new Set(outcome.assets.map((a) => a.filePath)).size).toBe(3);
  });

  // One request that already returns four must not become four requests.
  it('makes a single request when the endpoint returns them all at once', async () => {
    generate.mockImplementation(() => Promise.resolve(ok(4)));
    const outcome = await run(gptImage, { n: 4 });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(outcome.assets).toHaveLength(4);
  });

  /**
   * The remainder case, which is where money leaks: 9 wanted at 4 per request
   * is 4 + 4 + 1, not 4 + 4 + 4. The third round must ask for one.
   */
  it('asks only for the remainder in the final round', async () => {
    generate.mockImplementation((req: { params?: { n?: number } }) => Promise.resolve(ok(req.params?.n ?? 1)));
    const outcome = await run(gptImage, { n: 9 });

    expect(generate.mock.calls.map((c) => c[0].params.n)).toEqual([4, 4, 1]);
    expect(outcome.assets).toHaveLength(9);
  });

  it('leaves a single-image request completely alone', async () => {
    await run(seedream, { n: 1 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  /**
   * This path is reachable by an agent through the media MCP tool, where each
   * image is a charge and nothing else bounds the number.
   */
  it('refuses to expand beyond the ceiling however many are asked for', async () => {
    await run(seedream, { n: 500 });
    expect(generate).toHaveBeenCalledTimes(MAX_IMAGE_FAN_OUT);
  });

  it('stops after a failure instead of paying to rediscover it', async () => {
    generate
      .mockImplementationOnce(() => Promise.resolve(ok(1)))
      .mockImplementationOnce(() =>
        Promise.resolve({ success: false, assets: [], text: 'rate limited', error: 'http-429' })
      );

    const outcome = await run(seedream, { n: 4 });

    expect(generate).toHaveBeenCalledTimes(2);
    // What was already produced (and paid for) is still handed back.
    expect(outcome.assets).toHaveLength(1);
    expect(outcome.success).toBe(true);
    expect(outcome.text).toContain('1 of 4');
  });

  it('reports the failure when the very first round produced nothing', async () => {
    generate.mockImplementation(() => Promise.resolve({ success: false, assets: [], text: 'boom', error: 'http-500' }));
    const outcome = await run(seedream, { n: 4 });

    expect(outcome.success).toBe(false);
    expect(outcome.error).toBe('http-500');
  });

  // Cancelling has to stop the spend, not just hide results already bought.
  it('stops issuing requests once the signal aborts', async () => {
    const controller = new AbortController();
    generate.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(ok(1));
    });

    await run(seedream, { n: 5 }, { signal: controller.signal });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  /**
   * `clipParams` removes `n` for this model, and an unqualified "n was ignored,
   * do not retry" would teach an agent never to ask for several images again —
   * while the request as a whole did honor it.
   */
  it('does not report n as an ignored parameter after fanning out', async () => {
    const outcome = await run(seedream, { n: 3 });
    expect(outcome.droppedParams || []).not.toContain('n');
    expect(outcome.text).not.toContain('Do not retry');
  });
});
