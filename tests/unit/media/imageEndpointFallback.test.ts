/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seedream behind a relay gateway: the plain `/v1/images/generations` route
 * answers `404 model "..." not found` because the gateway mounts seedream under
 * `/api/seedream/v1`. The Form A adapter must retry the gateway route on its
 * own — the same "you should not have to know to pick the protocol by hand"
 * fix the video side got, but within one adapter rather than a protocol swap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import { ClientFactory } from '@/common/api/ClientFactory';
import { OpenAiImagesAdapter } from '@/common/media/adapters/openaiImagesAdapter';
import { resolveMediaModelSpec } from '@/common/media/catalog';
import type { TProviderWithModel } from '@/common/config/storage';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A gateway that fronts chat but mounts seedream only under /api/seedream/v1. */
const gatewayProvider: TProviderWithModel = {
  id: 'gw',
  platform: 'openai',
  name: 'Relay',
  base_url: 'https://gw.example.com/v1',
  api_key: 'sk-test',
  use_model: 'doubao-seedream-5-0-pro',
};

function fakeClient(behavior: () => Promise<unknown>): OpenAIRotatingClient {
  const client = Object.create(OpenAIRotatingClient.prototype) as OpenAIRotatingClient;
  (client as unknown as { createImage: () => Promise<unknown> }).createImage = vi.fn(behavior);
  (client as unknown as { createImageEdit: () => Promise<unknown> }).createImageEdit = vi.fn(behavior);
  return client;
}

const modelNotFound = () => Promise.reject(new Error('404 model "doubao-seedream-5-0-pro" not found'));
const anImage = () => Promise.resolve({ created: 0, data: [{ b64_json: TINY_PNG_B64 }] });

describe('seedream image gateway fallback (Form A)', () => {
  let workspaceDir: string;
  const adapter = new OpenAiImagesAdapter();

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-seedream-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  const run = (provider: TProviderWithModel, onEndpointStyleSwitched?: (s: string) => void) =>
    adapter.generate({
      kind: 'image',
      prompt: 'a red bicycle',
      params: { size: '1K' },
      inputUris: [],
      provider,
      spec: resolveMediaModelSpec('image', provider, provider.use_model),
      workspaceDir,
      onEndpointStyleSwitched,
    });

  it('retries the seedream gateway route when the plain route 404s the model, and reports the switch', async () => {
    const created = vi.spyOn(ClientFactory, 'createRotatingClient').mockImplementation(async (_p, opts) => {
      const url = (opts as { baseConfig?: { baseURL?: string } }).baseConfig?.baseURL ?? '';
      return fakeClient(url.includes('/api/seedream/v1') ? anImage : modelNotFound);
    });
    const switched = vi.fn();

    const outcome = await run(gatewayProvider, switched);

    expect(outcome.success).toBe(true);
    expect(outcome.assets).toHaveLength(1);
    expect(switched).toHaveBeenCalledWith('seedream-gateway');
    // plain route tried first, gateway route second
    const baseUrlOf = (i: number) =>
      (created.mock.calls[i][1] as { baseConfig?: { baseURL?: string } })?.baseConfig?.baseURL ?? '';
    expect(baseUrlOf(0)).not.toContain('/api/seedream/v1');
    expect(baseUrlOf(1)).toContain('/api/seedream/v1');
  });

  it('falls back from a wrongly pinned gateway to the plain route and clears the pin', async () => {
    const pinned: TProviderWithModel = {
      ...gatewayProvider,
      base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      model_settings: { 'doubao-seedream-5-0-pro': { model_kind: 'image', media_endpoint: 'seedream-gateway' } },
    };
    vi.spyOn(ClientFactory, 'createRotatingClient').mockImplementation(async (_p, opts) => {
      const url = (opts as { baseConfig?: { baseURL?: string } }).baseConfig?.baseURL ?? '';
      return fakeClient(url.includes('/api/seedream/v1') ? modelNotFound : anImage);
    });
    const switched = vi.fn();

    const outcome = await run(pinned, switched);

    expect(outcome.success).toBe(true);
    expect(switched).toHaveBeenCalledWith('');
  });

  it('does not retry on an honest auth failure', async () => {
    const created = vi
      .spyOn(ClientFactory, 'createRotatingClient')
      .mockResolvedValue(fakeClient(() => Promise.reject(new Error('401 invalid api key'))));
    const switched = vi.fn();

    const outcome = await run(gatewayProvider, switched);

    expect(outcome.success).toBe(false);
    expect(switched).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('does not touch non-seedream models', async () => {
    const dalle: TProviderWithModel = { ...gatewayProvider, use_model: 'dall-e-3' };
    const created = vi
      .spyOn(ClientFactory, 'createRotatingClient')
      .mockResolvedValue(fakeClient(() => Promise.reject(new Error('404 model "dall-e-3" not found'))));
    const switched = vi.fn();

    const outcome = await run(dalle, switched);

    expect(outcome.success).toBe(false);
    expect(switched).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledTimes(1);
  });
});
