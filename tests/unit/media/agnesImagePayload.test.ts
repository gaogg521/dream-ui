/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Agnes image request body.
 *
 * `agnes-image-2.1-flash` failed with `400 n must be 1` because it matched no
 * catalog entry and fell to the OpenAI-shaped default. Its docs disagree with
 * that shape in four separate places at once, and only the first one announced
 * itself:
 *
 *   - `n` is not a parameter.
 *   - `size` is REQUIRED, and is a tier (1K-4K), not pixels.
 *   - the aspect ratio is its own `ratio` field.
 *   - a reference image is `image: string[]` in the JSON body.
 *
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-image-21-flash (2026-09-11)
 * verified: https://agnes-ai.com/zh-Hans/docs/agnes-image-25-flash (2026-09-11)
 */

import { describe, expect, it } from 'vitest';
import { buildAgnesImageBody } from '@/common/media/adapters/agnesImage';
import { AGNES_IMAGE_RATIOS, AGNES_IMAGE_SIZES, AGNES_IMAGE_STYLE } from '@/common/media/catalog/imageModels';
import { resolveMediaModelSpec } from '@/common/media/catalog/resolve';

const provider = { platform: 'openai', base_url: 'https://apihub.agnes-ai.com/v1', name: 'Agnes' };

describe('Agnes image request body', () => {
  it('never carries the fields Agnes has no parameter for', () => {
    const body = buildAgnesImageBody('agnes-image-2.5-flash', 'a red bicycle', {
      n: 4,
      seed: 7,
      negativePrompt: 'blurry',
      quality: 'hd',
    } as never);

    for (const field of ['n', 'seed', 'negative_prompt', 'quality']) {
      expect(body, `${field} is not an Agnes parameter`).not.toHaveProperty(field);
    }
    expect(body.model).toBe('agnes-image-2.5-flash');
    expect(body.prompt).toBe('a red bicycle');
  });

  it('always sends a size, because Agnes requires one', () => {
    // No size chosen at all — the request still has to carry a tier.
    expect(buildAgnesImageBody('m', 'p', {} as never).size).toBe('2K');
    expect(buildAgnesImageBody('m', 'p', { size: '3K' } as never).size).toBe('3K');
    expect(buildAgnesImageBody('m', 'p', { size: '4k' } as never).size).toBe('4K');
  });

  it('falls back to a tier when handed pixels', () => {
    // `1024x1024` is tolerated but normalized server-side, so the visible
    // result would not match what the user picked. Send a tier and let `ratio`
    // shape the frame.
    expect(buildAgnesImageBody('m', 'p', { size: '1920x1080' } as never).size).toBe('2K');
  });

  it('puts the aspect ratio in `ratio`, not folded into `size`', () => {
    const body = buildAgnesImageBody('m', 'p', { size: '2K', aspectRatio: '16:9' } as never);
    expect(body.size).toBe('2K');
    expect(body.ratio).toBe('16:9');
  });

  it('carries reference images as an array in the body', () => {
    const one = buildAgnesImageBody('m', 'p', {} as never, ['https://x.test/a.png']);
    expect(one.image).toEqual(['https://x.test/a.png']);

    // Multi-image composition is the same field with more entries.
    const many = buildAgnesImageBody('m', 'p', {} as never, ['https://x.test/a.png', 'data:image/png;base64,AA']);
    expect(many.image).toHaveLength(2);

    // Text-to-image must not send an empty array.
    expect(buildAgnesImageBody('m', 'p', {} as never, [])).not.toHaveProperty('image');
  });
});

describe('Agnes image catalog entry', () => {
  it.each(['agnes-image-2.1-flash', 'agnes-image-2.5-flash'])('routes %s to its own entry', (model) => {
    const spec = resolveMediaModelSpec('image', provider, model);
    expect(spec?.id).toBe('agnes-image');
    expect(spec?.endpointStyle).toBe(AGNES_IMAGE_STYLE);
  });

  it('offers only what the API accepts', () => {
    const spec = resolveMediaModelSpec('image', provider, 'agnes-image-2.5-flash');

    expect(spec?.params.sizes).toEqual(AGNES_IMAGE_SIZES);
    expect(spec?.params.aspectRatios).toEqual(AGNES_IMAGE_RATIOS);
    expect(spec?.params.maxN ?? 1).toBe(1);
    // Absent rather than false-y by accident: offering a control that does
    // nothing is worse than not offering it.
    expect(spec?.params.seed).toBeFalsy();
    expect(spec?.params.negativePrompt).toBeFalsy();
    // A size is required, so the entry must supply one when the caller does not.
    expect(spec?.defaults?.size).toBe('2K');
  });

  it('does not capture an Agnes-named model served by some other host', () => {
    // The body shape is Agnes-specific; a relay that merely has "agnes" in the
    // model name would be handed a request its own API does not understand.
    const elsewhere = { platform: 'openai', base_url: 'https://relay.example.com/v1', name: 'Relay' };
    expect(resolveMediaModelSpec('image', elsewhere, 'agnes-image-2.5-flash')?.id).not.toBe('agnes-image');
  });
});
