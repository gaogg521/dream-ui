/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Locks the MODEL_PLATFORMS presentation order: the array order is what the
 * add-platform picker renders, so partner placement is part of the contract.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_PLATFORM_VALUE, MODEL_PLATFORMS, platformNeedsApiKey } from '@renderer/utils/model/modelPlatforms';

describe('MODEL_PLATFORMS ordering', () => {
  it('keeps Custom first and pins both Moonshot entries right after it', () => {
    const values = MODEL_PLATFORMS.map((p) => p.value);
    expect(values[0]).toBe('custom');
    expect(values[1]).toBe('Moonshot');
    expect(values[2]).toBe('Moonshot-Global');
  });

  it('defaults the add-model modal platform to the first list entry', () => {
    expect(DEFAULT_PLATFORM_VALUE).toBe(MODEL_PLATFORMS[0].value);
    expect(DEFAULT_PLATFORM_VALUE).toBe('custom');
  });

  it('defines each Moonshot entry exactly once', () => {
    const moonshotEntries = MODEL_PLATFORMS.filter((p) => p.value.startsWith('Moonshot'));
    expect(moonshotEntries.map((p) => p.value)).toEqual(['Moonshot', 'Moonshot-Global']);
    expect(moonshotEntries.map((p) => p.base_url)).toEqual([
      'https://api.moonshot.cn/v1',
      'https://api.moonshot.ai/v1',
    ]);
  });
});

describe('platformNeedsApiKey', () => {
  it('exempts exactly the platforms that authenticate some other way', () => {
    // Bedrock's credentials live in bedrock_config; a local Ollama daemon has
    // none at all. These two, and only these two, are what the backend's
    // `platform_authenticates_without_api_key` exempts.
    expect(platformNeedsApiKey('bedrock')).toBe(false);
    expect(platformNeedsApiKey('ollama')).toBe(false);
  });

  it('requires a key for Gemini and Vertex', () => {
    // The regression this pins: the Add-Platform refresh button used to wave
    // both Gemini variants past its "please enter an API key" warning, while
    // the model-list hook still gated them on a key. Neither path ran, so the
    // click did nothing and said nothing. The backend needs the key either
    // way — it appends `?key=` to the Gemini model request, and neither
    // variant appears in its exemption list.
    expect(platformNeedsApiKey('gemini')).toBe(true);
    expect(platformNeedsApiKey('gemini-vertex-ai')).toBe(true);
  });

  it('requires a key for ordinary HTTP platforms', () => {
    expect(platformNeedsApiKey('custom')).toBe(true);
    expect(platformNeedsApiKey('new-api')).toBe(true);
  });

  it('errs toward asking when the platform is not yet chosen', () => {
    // The form calls this before a platform is selected. Answering "no key
    // needed" there would suppress the warning for every platform.
    expect(platformNeedsApiKey(undefined)).toBe(true);
  });
});
