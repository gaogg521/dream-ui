/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two defences against a protocol the catalog had to guess.
 *
 * Background: the built-in catalog matches Seedance on the model name alone and
 * resolves it to Volcano Ark's native task API — deliberately, since pinning it
 * to a host would write one deployment's address into the product. The cost is
 * that the same model behind a relay gateway is pointed at an API that gateway
 * does not proxy, and until now the only recovery was for the user to know to
 * pick `seedance-gateway` by hand in model settings.
 *
 * Two things close that: the executor retries the sibling protocol when a
 * submission proves the first one is not routed (and reports the one that
 * worked, so the discovery gets stored), and the send box warns beforehand when
 * a guessed protocol's expected host does not match the configured one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskPollAdapter } from '@/common/media/adapters/taskPollAdapter';
import { ENDPOINT_STYLE_FALLBACKS, fallbackEndpointStyles } from '@/common/media/catalog/endpointFallbacks';
import {
  diagnoseAutoEndpointMismatch,
  IMPLEMENTED_ENDPOINT_STYLES,
  resolveMediaModelSpec,
} from '@/common/media/catalog/resolve';
import { getTaskDriver } from '@/common/media/adapters/taskDrivers';
import type { MediaGenRequest } from '@/common/media/types';
import type { TProviderWithModel } from '@/common/config/storage';

/** A relay gateway: OpenAI-compatible chat root, nothing to do with Ark's host. */
const relayProvider: TProviderWithModel = {
  id: 'relay',
  platform: 'openai',
  name: 'Relay Gateway',
  base_url: 'https://relay.example.com/v1',
  api_key: 'sk-relay',
  use_model: 'seedance-2-0-fast',
};

const ARK_SUBMIT = '/contents/generations/tasks';
const GATEWAY_SUBMIT = '/api/seedance/createVideo';
const GATEWAY_POLL = '/api/seedance/getVideoResult';

/** How this gateway answers a path it does not route: 200, empty body. */
const notRouted = () => new Response('', { status: 200 });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const videoBytes = () =>
  new Response(Buffer.from('not-a-real-mp4'), { status: 200, headers: { 'content-type': 'video/mp4' } });

describe('endpoint style fallbacks (data)', () => {
  it('pairs ark-task and seedance-gateway in both directions', () => {
    expect(fallbackEndpointStyles('ark-task')).toEqual(['seedance-gateway']);
    expect(fallbackEndpointStyles('seedance-gateway')).toEqual(['ark-task']);
  });

  it('has nothing to say about a style with no sibling', () => {
    expect(fallbackEndpointStyles('dashscope-task')).toEqual([]);
    expect(fallbackEndpointStyles('not-a-style')).toEqual([]);
    expect(fallbackEndpointStyles(undefined)).toEqual([]);
  });

  /**
   * The table names wire protocols, and offering one with no driver would turn
   * a recoverable failure into a confusing second one.
   */
  it('only names styles that are implemented and have a driver', () => {
    for (const [style, candidates] of Object.entries(ENDPOINT_STYLE_FALLBACKS)) {
      expect(IMPLEMENTED_ENDPOINT_STYLES, `${style} is not implemented`).toContain(style);
      expect(getTaskDriver(style), `${style} has no driver`).toBeTruthy();
      for (const candidate of candidates) {
        expect(IMPLEMENTED_ENDPOINT_STYLES, `${candidate} is not implemented`).toContain(candidate);
        expect(getTaskDriver(candidate), `${candidate} has no driver`).toBeTruthy();
      }
    }
  });
});

describe('TaskPollAdapter protocol fallback', () => {
  const adapter = new TaskPollAdapter();
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fallback-test-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  const buildRequest = (overrides: Partial<MediaGenRequest> = {}): MediaGenRequest => {
    const spec = resolveMediaModelSpec('video', relayProvider, relayProvider.use_model);
    // The premise of every case below: the catalog guessed Ark's native API.
    expect(spec?.endpointStyle).toBe('ark-task');
    return {
      kind: 'video',
      prompt: 'a cat flying in the sky',
      params: { resolution: '480p', durationSeconds: 5 },
      inputUris: [],
      provider: relayProvider,
      spec: spec ? { ...spec, polling: { intervalMs: 5, timeoutMs: 5000 } } : null,
      workspaceDir,
      ...overrides,
    };
  };

  it('retries under the sibling protocol, polls it, and reports the style that worked', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes(ARK_SUBMIT)) return notRouted();
      if (href.includes(GATEWAY_SUBMIT)) return json({ id: 'cgt-1' });
      if (href.includes(GATEWAY_POLL)) {
        return json({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/out.mp4' } });
      }
      return videoBytes();
    });
    vi.stubGlobal('fetch', fetchMock);

    const switched: string[] = [];
    const outcome = await adapter.generate(buildRequest({ onEndpointStyleSwitched: (style) => switched.push(style) }));

    expect(outcome.success).toBe(true);
    expect(outcome.assets).toHaveLength(1);
    await expect(fs.promises.access(outcome.assets[0].filePath)).resolves.toBeUndefined();
    // Reported so the job engine can store it — without this the probe is
    // re-bought on every generation.
    expect(switched).toEqual(['seedance-gateway']);
    // Polling must follow the protocol that issued the id, not the configured
    // one, which never heard of it.
    const requested = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requested.some((href) => href.includes(GATEWAY_POLL))).toBe(true);
    expect(requested.some((href) => href.includes(`${ARK_SUBMIT}/cgt-1`))).toBe(false);
  });

  it('does not retry a failure that means the path WAS routed', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes(ARK_SUBMIT)) {
        return new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 });
      }
      return json({ id: 'should-not-happen' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const switched: string[] = [];
    const outcome = await adapter.generate(buildRequest({ onEndpointStyleSwitched: (style) => switched.push(style) }));

    expect(outcome.success).toBe(false);
    expect(switched).toEqual([]);
    // A refused request is honest information; probing another protocol with it
    // would produce a second, more confusing error.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes(GATEWAY_SUBMIT))).toBe(true);
    expect(String(outcome.error)).toContain('401');
  });

  it('reports the configured protocol plus what else was tried when both are unrouted', async () => {
    const fetchMock = vi.fn(async () => notRouted());
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await adapter.generate(buildRequest());

    expect(outcome.success).toBe(false);
    // The original message names the protocol the user configured; the appended
    // line keeps the advice that follows from reading as an untried suggestion.
    expect(String(outcome.error)).toContain('Ark task submission');
    expect(String(outcome.error)).toContain('seedance-gateway');
    expect(String(outcome.error)).toMatch(/automatically retried/i);
  });

  it('falls back the other way too, for a manually pinned gateway style', async () => {
    const pinned: TProviderWithModel = {
      ...relayProvider,
      base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      model_settings: { 'seedance-2-0-fast': { model_kind: 'video', media_endpoint: 'seedance-gateway' } },
    };
    const spec = resolveMediaModelSpec('video', pinned, pinned.use_model);
    expect(spec?.endpointStyle).toBe('seedance-gateway');

    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes(GATEWAY_SUBMIT)) return notRouted();
      if (href.includes(ARK_SUBMIT)) {
        return href.includes('cgt-2')
          ? json({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/out.mp4' } })
          : json({ id: 'cgt-2' });
      }
      return videoBytes();
    });
    vi.stubGlobal('fetch', fetchMock);

    const switched: string[] = [];
    const outcome = await adapter.generate({
      kind: 'video',
      prompt: 'a cat flying in the sky',
      params: {},
      inputUris: [],
      provider: pinned,
      spec: spec ? { ...spec, polling: { intervalMs: 5, timeoutMs: 5000 } } : null,
      workspaceDir,
      onEndpointStyleSwitched: (style) => switched.push(style),
    });

    expect(outcome.success).toBe(true);
    expect(switched).toEqual(['ark-task']);
  });
});

describe('diagnoseAutoEndpointMismatch', () => {
  it('flags a name-matched vendor protocol against a host that is not the vendor', () => {
    const diagnosis = diagnoseAutoEndpointMismatch('video', relayProvider, 'seedance-2-0-fast');
    expect(diagnosis?.kind).toBe('hostMismatch');
    expect(diagnosis).toMatchObject({ baseUrl: relayProvider.base_url, hints: ['volces.com'] });
  });

  it('stays quiet when the host is the one that protocol expects', () => {
    const ark = { ...relayProvider, base_url: 'https://ark.cn-beijing.volces.com/api/v3' };
    expect(diagnoseAutoEndpointMismatch('video', ark, 'seedance-2-0-fast')).toBeNull();
  });

  /** An explicit choice belongs to the settings modal's own warning, not this one. */
  it('stays quiet when the user picked the protocol themselves', () => {
    const declared = {
      ...relayProvider,
      model_settings: { 'seedance-2-0-fast': { model_kind: 'video', media_endpoint: 'ark-task' } },
    };
    expect(diagnoseAutoEndpointMismatch('video', declared, 'seedance-2-0-fast')).toBeNull();
  });

  it('stays quiet for a model the catalog does not resolve at all', () => {
    expect(diagnoseAutoEndpointMismatch('video', relayProvider, 'some-chat-model')).toBeNull();
    expect(diagnoseAutoEndpointMismatch('video', relayProvider, '')).toBeNull();
  });

  /**
   * The seedream image entry carries no endpointStyle (it is the plain images
   * route), but it has the same name-only match + relay-gateway failure mode as
   * Seedance, so it gets the same early hint.
   */
  it('flags seedream on a non-Ark host even though it has no endpointStyle', () => {
    const relaySeedream = { ...relayProvider, use_model: 'doubao-seedream-5-0-pro' };
    const diagnosis = diagnoseAutoEndpointMismatch('image', relaySeedream, 'doubao-seedream-5-0-pro');
    expect(diagnosis?.kind).toBe('hostMismatch');
    expect(diagnosis).toMatchObject({ hints: ['volces.com'] });
  });

  it('stays quiet for seedream pointed straight at Ark', () => {
    const arkSeedream = {
      ...relayProvider,
      base_url: 'https://ark.cn-beijing.volces.com/api/v3',
      use_model: 'doubao-seedream-5-0-pro',
    };
    expect(diagnoseAutoEndpointMismatch('image', arkSeedream, 'doubao-seedream-5-0-pro')).toBeNull();
  });

  it('stays quiet for seedream when the user already pinned an endpoint', () => {
    const declared = {
      ...relayProvider,
      use_model: 'doubao-seedream-5-0-pro',
      model_settings: { 'doubao-seedream-5-0-pro': { model_kind: 'image', media_endpoint: 'seedream-gateway' } },
    };
    expect(diagnoseAutoEndpointMismatch('image', declared, 'doubao-seedream-5-0-pro')).toBeNull();
  });
});
