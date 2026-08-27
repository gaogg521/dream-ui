/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  clipParamsToSpec,
  EXECUTABLE_FORMS,
  IMPLEMENTED_ENDPOINT_STYLES,
  isMediaGenSupported,
  isSpecExecutable,
  resolveMediaModelSpec,
} from '@/common/media/catalog';
import type { MediaModelSpec } from '@/common/media/catalog/types';
import { REGISTERED_DRIVER_IDS } from '@/common/media/adapters/taskDrivers';
import { isImageGenSupported } from '@/common/utils/imageModelAllowlist';

describe('media catalog resolution', () => {
  describe('legacy allowlist behavior is preserved (Form B entries)', () => {
    it('supports gemini platform image models', () => {
      const provider = { platform: 'gemini', base_url: '', name: 'Google' };
      expect(isImageGenSupported(provider, 'gemini-2.5-flash-image-preview')).toBe(true);
      expect(resolveMediaModelSpec('image', provider, 'gemini-2.5-flash-image-preview')?.form).toBe('B');
    });

    it('supports gemini-vertex-ai platform image models', () => {
      const provider = { platform: 'gemini-vertex-ai', base_url: '', name: 'Vertex' };
      expect(isImageGenSupported(provider, 'imagine-3')).toBe(true);
    });

    it('supports openrouter-hosted image chat models', () => {
      const provider = { platform: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', name: 'OpenRouter' };
      expect(isImageGenSupported(provider, 'google/gemini-2.5-flash-image-preview')).toBe(true);
      expect(isImageGenSupported(provider, 'nano-banana')).toBe(true);
    });

    it('supports antigravity providers by name', () => {
      const provider = { platform: 'openai', base_url: 'https://example.com/v1', name: 'AntigravityTools' };
      expect(isImageGenSupported(provider, 'gemini-3-pro-image-1x1')).toBe(true);
      expect(resolveMediaModelSpec('image', provider, 'gemini-3-pro-image-1x1')?.id).toBe('antigravity-image');
    });

    it('still rejects gemini text models', () => {
      const provider = { platform: 'gemini', base_url: '', name: 'Google' };
      expect(isImageGenSupported(provider, 'gemini-2.5-pro')).toBe(false);
    });
  });

  describe('Form A entries (new coverage)', () => {
    it('supports dall-e-3 on OpenAI-compatible providers', () => {
      const provider = { platform: 'openai', base_url: 'https://api.openai.com/v1', name: 'OpenAI' };
      const spec = resolveMediaModelSpec('image', provider, 'dall-e-3');
      expect(spec?.form).toBe('A');
      expect(isImageGenSupported(provider, 'dall-e-3')).toBe(true);
    });

    it('supports gpt-image-1 and declares image input', () => {
      const provider = { platform: 'openai', base_url: 'https://api.openai.com/v1', name: 'OpenAI' };
      const spec = resolveMediaModelSpec('image', provider, 'gpt-image-1');
      expect(spec?.form).toBe('A');
      expect(spec?.params.imageInput).toBe(true);
    });

    // Pinning the generation number left working gateway models unselectable,
    // which silently sent them down the chat fallback instead of the images API.
    it.each(['gpt-image-2', 'gpt-image-2-joymaker', 'gpt-image-3'])(
      'matches the whole gpt-image family: %s',
      (model) => {
        const provider = { platform: 'custom', base_url: 'https://gateway.example.com/', name: 'gw' };
        expect(resolveMediaModelSpec('image', provider, model)?.id).toBe('openai-gpt-image');
        expect(isImageGenSupported(provider, model)).toBe(true);
      }
    );

    it('supports FLUX and SD models on gateways', () => {
      const provider = { platform: 'new-api', base_url: 'https://api.siliconflow.cn/v1', name: 'SiliconFlow' };
      expect(isImageGenSupported(provider, 'black-forest-labs/FLUX.1-schnell')).toBe(true);
      expect(isImageGenSupported(provider, 'stabilityai/stable-diffusion-3-5-large')).toBe(true);
    });

    it('does not fire generic Form A entries on non-OpenAI-compatible platforms', () => {
      const provider = { platform: 'anthropic', base_url: 'https://api.anthropic.com', name: 'Anthropic' };
      expect(isImageGenSupported(provider, 'dall-e-3')).toBe(false);
      expect(resolveMediaModelSpec('image', provider, 'dall-e-3')).toBeNull();
    });
  });

  describe('Form C (async task APIs, driven by the media job engine)', () => {
    it('supports WanX images now that the async engine exists', () => {
      const provider = {
        platform: 'openai',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        name: 'DashScope',
      };
      const spec = resolveMediaModelSpec('image', provider, 'wanx2.1-t2i-turbo');
      expect(spec?.form).toBe('C');
      expect(spec?.endpointStyle).toBe('dashscope-task');
      expect(EXECUTABLE_FORMS).toContain('C');
      expect(isImageGenSupported(provider, 'wanx2.1-t2i-turbo')).toBe(true);
    });

    it('supports seedance video via the Ark driver', () => {
      const provider = { platform: 'openai', base_url: 'https://ark.cn-beijing.volces.com/api/v3', name: 'Ark' };
      const spec = resolveMediaModelSpec('video', provider, 'doubao-seedance-1-0-pro');
      expect(spec?.form).toBe('C');
      expect(isMediaGenSupported('video', provider, 'doubao-seedance-1-0-pro')).toBe(true);
    });

    // These three shipped drivers in 2026-08-06; before that they were catalog
    // entries only and had to report unsupported. The assertion flipped on
    // purpose — what stays fixed is that support tracks the driver registry.
    it.each([
      ['kling-v1-6', 'kling'],
      ['sora-2', 'openai-video'],
      ['cogvideox-3', 'cogvideox'],
    ])('offers %s now that its %s driver is implemented', (model, endpointStyle) => {
      const provider = { platform: 'openai', base_url: 'https://gateway.example.com/v1', name: 'Gateway' };
      const spec = resolveMediaModelSpec('video', provider, model);
      expect(spec?.endpointStyle).toBe(endpointStyle);
      expect(IMPLEMENTED_ENDPOINT_STYLES).toContain(endpointStyle);
      expect(isMediaGenSupported('video', provider, model)).toBe(true);
    });

    // The invariant the cases above used to guard, kept alive with a style that
    // genuinely has no driver: a catalog entry alone must never make a model
    // selectable, or the picker offers something that fails only at call time.
    it('still refuses an endpoint style that has no driver', () => {
      const orphan: MediaModelSpec = {
        id: 'future-vendor',
        kind: 'video',
        form: 'C',
        endpointStyle: 'not-implemented-yet',
        match: { model: /future-vendor/i },
        params: {},
        polling: { intervalMs: 1000, timeoutMs: 1000 },
      };
      expect(IMPLEMENTED_ENDPOINT_STYLES).not.toContain('not-implemented-yet');
      expect(isSpecExecutable(orphan)).toBe(false);
    });

    it('keeps the catalog list and the driver registry in sync', () => {
      // Drift here is what would let a half-finished driver reach the picker.
      expect([...IMPLEMENTED_ENDPOINT_STYLES].toSorted()).toEqual([...REGISTERED_DRIVER_IDS].toSorted());
    });
  });

  describe('clipParamsToSpec', () => {
    const openaiProvider = { platform: 'openai', base_url: 'https://api.openai.com/v1', name: 'OpenAI' };

    it('keeps supported params and merges defaults underneath', () => {
      const spec = resolveMediaModelSpec('image', openaiProvider, 'dall-e-3');
      const { params, dropped } = clipParamsToSpec({ size: '1792x1024' }, spec);
      expect(params.size).toBe('1792x1024');
      expect(params.quality).toBe('standard'); // default merged
      expect(dropped).toEqual([]);
    });

    it('drops unsupported params and reports them', () => {
      const spec = resolveMediaModelSpec('image', openaiProvider, 'dall-e-3');
      const { params, dropped } = clipParamsToSpec({ seed: 42, negativePrompt: 'blur', n: 4 }, spec);
      expect(params.seed).toBeUndefined();
      expect(params.negativePrompt).toBeUndefined();
      expect(dropped).toContain('seed');
      expect(dropped).toContain('negativePrompt');
      // dall-e-3 maxN=1 → n>1 dropped
      expect(dropped).toContain('n');
    });

    it('drops values outside the declared vocabulary', () => {
      const spec = resolveMediaModelSpec('image', openaiProvider, 'dall-e-3');
      const { params, dropped } = clipParamsToSpec({ size: '999x999' }, spec);
      expect(dropped).toContain('size');
      // default still applies after the invalid value is dropped
      expect(params.size).toBe('1024x1024');
    });

    it('clamps n to maxN when multi-output is supported', () => {
      const spec = resolveMediaModelSpec('image', openaiProvider, 'gpt-image-1');
      const { params } = clipParamsToSpec({ n: 10 }, spec);
      expect(params.n).toBe(4);
    });

    /**
     * Seedream returns one image per request — measured against Ark, which
     * answers `n: 2` and even `n: 99` with a single image. `maxN` describes
     * that, so it stays 1 here; several images come from several requests
     * (`executeMediaGeneration`'s fan-out), not from this layer.
     */
    it('reports one image per request for seedream, whatever n asks for', () => {
      const spec = resolveMediaModelSpec('image', openaiProvider, 'doubao-seedream-5-0-pro');
      const { params } = clipParamsToSpec({ n: 4 }, spec);
      expect(params.n).toBeUndefined();
    });

    it('drops everything except n=1 semantics with a null spec (fallback path)', () => {
      const { params, dropped } = clipParamsToSpec({ size: '1024x1024', seed: 1, n: 1 }, null);
      expect(params.size).toBeUndefined();
      expect(params.seed).toBeUndefined();
      expect(params.n).toBe(1);
      expect(dropped).toEqual(expect.arrayContaining(['size', 'seed']));
    });
  });

  describe('Agnes video (host-pinned entry)', () => {
    const MODEL = 'agnes-video-v2.0';
    const atVendor = {
      platform: 'custom',
      name: 'Agnes',
      base_url: 'https://apihub.agnes-ai.com/v1',
      model_settings: { [MODEL]: { model_kind: 'video' } },
    };
    const behindRelay = {
      platform: 'custom',
      name: 'Relay',
      base_url: 'https://litellm-internal.example.com/v1',
      model_settings: { [MODEL]: { model_kind: 'video' } },
    };

    /**
     * The gap this closes: `agnes-task` was the only implemented driver with no
     * catalog entry, and video refuses to guess an endpoint style, so declaring
     * the model as video resolved to null and the picker hid it outright.
     */
    it('resolves to the agnes driver when the provider points at the vendor', () => {
      const spec = resolveMediaModelSpec('video', atVendor, MODEL);
      expect(spec?.id).toBe('agnes-video');
      expect(spec?.form).toBe('C');
      expect(spec?.endpointStyle).toBe('agnes-task');
      expect(isMediaGenSupported('video', atVendor, MODEL)).toBe(true);
    });

    /**
     * Deliberately NOT matched by name alone. The driver ignores `base_url` and
     * always calls the vendor host, so a name-only match would push a
     * gateway-served model past its gateway with the gateway's key — and
     * `agnes-task` has no sibling protocol to recover with. Staying unresolved
     * is the conservative answer; the user declares the style if they know it.
     */
    it('stays unresolved for an agnes-named model served by some other host', () => {
      expect(resolveMediaModelSpec('video', behindRelay, MODEL)).toBeNull();
      expect(isMediaGenSupported('video', behindRelay, MODEL)).toBe(false);
    });

    it('still honours an explicit endpoint choice behind a relay', () => {
      const declared = {
        ...behindRelay,
        model_settings: { [MODEL]: { model_kind: 'video', media_endpoint: 'agnes-task' } },
      };
      expect(resolveMediaModelSpec('video', declared, MODEL)?.endpointStyle).toBe('agnes-task');
    });

    it('offers no resolution list, because the driver has no resolution knob', () => {
      const spec = resolveMediaModelSpec('video', atVendor, MODEL);
      expect(spec?.params?.resolutions).toBeUndefined();
      expect(spec?.params?.aspectRatios).toContain('16:9');
    });
  });
});
