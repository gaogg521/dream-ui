/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The gateway's own seedream contract.
 *
 * Image-to-image had been failing with a Go JSON-decoding error, which read as
 * a malformed request but was really the wrong route: we were sending OpenAI
 * multipart to `/v1/images/edits`, and this deployment has no such route. Both
 * shapes here — the `/api/seedream/v1` path and the reference image as a data
 * URI in the body — come from a request captured against the running gateway
 * and re-verified with this application's own credentials, so they are pinned
 * rather than inferred.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildSeedreamGatewayBody,
  seedreamGatewayBaseUrl,
  toGatewayImageRef,
} from '@/common/media/adapters/seedreamGateway';
import { resolveMediaModelSpec } from '@/common/media/catalog/resolve';

describe('seedreamGatewayBaseUrl', () => {
  /**
   * A provider configured for chat carries `/v1`. Appending the namespace to
   * that would give `/v1/api/seedream/v1`, so the version has to come off first.
   */
  it('replaces a chat version suffix with the gateway namespace', () => {
    expect(seedreamGatewayBaseUrl('https://gw.example.com/v1')).toBe('https://gw.example.com/api/seedream/v1');
  });

  it('handles a base url with no version and a trailing slash', () => {
    expect(seedreamGatewayBaseUrl('https://gw.example.com/')).toBe('https://gw.example.com/api/seedream/v1');
  });
});

describe('buildSeedreamGatewayBody', () => {
  it('sends the fields the gateway was observed to require', () => {
    const body = buildSeedreamGatewayBody('doubao-seedream-5-0-pro', 'a red bicycle', { size: '1K' });
    expect(body).toMatchObject({
      model: 'doubao-seedream-5-0-pro',
      prompt: 'a red bicycle',
      size: '1K',
      output_format: 'png',
      stream: false,
    });
  });

  // Paying for a watermarked image and finding out afterwards is not a recoverable mistake.
  it('always opts out of the watermark rather than trusting the default', () => {
    expect(buildSeedreamGatewayBody('m', 'p', {}).watermark).toBe(false);
  });

  it('carries the reference image in the body when there is one', () => {
    const body = buildSeedreamGatewayBody('m', 'p', {}, 'data:image/png;base64,AAA');
    expect(body.image).toBe('data:image/png;base64,AAA');
  });

  // The same route serves both directions; `image` is the only difference.
  it('omits the image field entirely for text-to-image', () => {
    expect('image' in buildSeedreamGatewayBody('m', 'p', {})).toBe(false);
  });
});

describe('toGatewayImageRef', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'seedream-ref-'));
    file = path.join(dir, 'ref.jpg');
    await fs.promises.writeFile(file, Buffer.from([0xff, 0xd8, 0xff]));
  });

  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('inlines a local file as a data URI with the type its extension implies', async () => {
    const ref = await toGatewayImageRef(file, dir);
    expect(ref).toBe(`data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString('base64')}`);
  });

  /**
   * The gateway fetches an HTTP reference itself. Downloading it here only to
   * re-upload it as base64 would move the bytes twice for no benefit.
   */
  it('passes an http url through untouched', async () => {
    const url = 'https://example.com/a.png';
    expect(await toGatewayImageRef(url, dir)).toBe(url);
  });
});

describe('declaring the style on a model', () => {
  const provider = {
    platform: 'custom',
    base_url: 'https://gw.example.com/v1',
    use_model: 'doubao-seedream-5-0-pro',
    api_key: 'k',
    model_settings: {
      'doubao-seedream-5-0-pro': { model_kind: 'image', media_endpoint: 'seedream-gateway' },
    },
  };

  /**
   * The decisive one. This style is synchronous, so it must stay on Form A —
   * routed to the async branch it would become a polling job waiting on a task
   * id the gateway never issues, and hang until the timeout instead of
   * returning the image it already produced.
   */
  it('stays synchronous instead of becoming a polling job', () => {
    const spec = resolveMediaModelSpec('image', provider as never, 'doubao-seedream-5-0-pro');
    expect(spec?.form).toBe('A');
    expect(spec?.endpointStyle).toBe('seedream-gateway');
    expect(spec?.polling).toBeUndefined();
  });

  it('declares that it takes a reference image, which is the point of the style', () => {
    const spec = resolveMediaModelSpec('image', provider as never, 'doubao-seedream-5-0-pro');
    expect(spec?.params.imageInput).toBe(true);
  });
});
