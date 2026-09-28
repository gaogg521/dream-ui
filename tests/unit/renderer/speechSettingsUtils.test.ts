/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEECH_TO_TEXT_CONFIG,
  OPENAI_SPEECH_MODEL_PRESETS,
  SPEECH_LANGUAGE_OPTIONS,
  applySpeechSource,
  buildModelOptions,
  deriveSpeechSource,
  getAutoTranscriptionPrompt,
  isValidHttpUrl,
  migrateSpeechLanguage,
  normalizeSpeechToTextConfig,
} from '@renderer/components/settings/SettingsModal/contents/SystemModalContent/VoiceInputSection/speechSettingsUtils';

describe('deriveSpeechSource', () => {
  it('returns hosted when provider is hosted', () => {
    const config = normalizeSpeechToTextConfig({ enabled: true, provider: 'hosted' });
    expect(deriveSpeechSource(config)).toBe('hosted');
  });

  it('defaults to hosted for openai provider without base_url', () => {
    const config = normalizeSpeechToTextConfig({ enabled: true, provider: 'openai' });
    expect(deriveSpeechSource(config)).toBe('hosted');
  });

  it('returns custom for openai provider with non-empty base_url', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', base_url: 'https://my-host/v1', model: 'whisper-1' },
    });
    expect(deriveSpeechSource(config)).toBe('custom');
  });

  it('returns model settings when a configured provider ID is stored', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      modelProviderId: 'openrouter',
      provider: 'openai',
    });
    expect(deriveSpeechSource(config)).toBe('modelSettings');
  });

  it('treats whitespace-only base_url as hosted', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', base_url: '  ', model: 'whisper-1' },
    });
    expect(deriveSpeechSource(config)).toBe('hosted');
  });
});

describe('applySpeechSource', () => {
  const customConfig = normalizeSpeechToTextConfig({
    enabled: true,
    provider: 'openai',
    openai: { api_key: 'k', base_url: 'https://my-host/v1', model: 'my-model' },
  });

  it('switching to hosted clears base_url and the modelProviderId', () => {
    const next = applySpeechSource(customConfig, 'hosted');
    expect(next.provider).toBe('hosted');
    expect(next.modelProviderId).toBeUndefined();
    expect(next.openai?.base_url).toBe('');
  });

  it('switching to modelSettings only changes provider and keeps openai sub-config', () => {
    const next = applySpeechSource(customConfig, 'modelSettings');
    expect(next.provider).toBe('openai');
    expect(next.openai?.base_url).toBe('https://my-host/v1');
  });

  it('switching to custom restores remembered base_url when current one is empty', () => {
    const hosted = applySpeechSource(customConfig, 'hosted');
    const next = applySpeechSource(hosted, 'custom', 'https://my-host/v1');
    expect(deriveSpeechSource(next)).toBe('custom');
    expect(next.openai?.base_url).toBe('https://my-host/v1');
  });

  it('switching to custom keeps existing base_url when already set', () => {
    const next = applySpeechSource(customConfig, 'custom', 'https://other/v1');
    expect(next.openai?.base_url).toBe('https://my-host/v1');
  });
});

describe('model presets', () => {
  it('openai presets exclude realtime-only models in phase 1', () => {
    expect(OPENAI_SPEECH_MODEL_PRESETS).toContain('gpt-4o-transcribe');
    expect(OPENAI_SPEECH_MODEL_PRESETS).toContain('whisper-1');
    expect(OPENAI_SPEECH_MODEL_PRESETS).not.toContain('gpt-realtime-whisper');
  });

  it('defaults use the hosted broker-backed provider with zero setup', () => {
    expect(DEFAULT_SPEECH_TO_TEXT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SPEECH_TO_TEXT_CONFIG.provider).toBe('hosted');
  });
});

describe('buildModelOptions', () => {
  it('returns presets as-is when current model is in presets', () => {
    expect(buildModelOptions(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });

  it('appends stored non-preset model so existing configs keep working', () => {
    expect(buildModelOptions(['a', 'b'], 'legacy-model')).toEqual(['a', 'b', 'legacy-model']);
  });

  it('ignores empty current model', () => {
    expect(buildModelOptions(['a'], '')).toEqual(['a']);
  });

  it('returns a copy so callers cannot mutate the preset constants', () => {
    const presets = ['a', 'b'];
    const options = buildModelOptions(presets, 'a');
    expect(options).not.toBe(presets);
  });
});

describe('isValidHttpUrl', () => {
  it('accepts http and https urls', () => {
    expect(isValidHttpUrl('https://my-host/v1')).toBe(true);
    expect(isValidHttpUrl('http://127.0.0.1:8000/v1')).toBe(true);
  });

  it('rejects other schemes and garbage', () => {
    expect(isValidHttpUrl('wss://my-host')).toBe(false);
    expect(isValidHttpUrl('my-host/v1')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
  });
});

describe('Chinese language options', () => {
  it('splits Chinese into Simplified and Traditional, with no ambiguous zh', () => {
    const values = SPEECH_LANGUAGE_OPTIONS.map((option) => option.value);
    expect(values).toContain('zh-CN');
    expect(values).toContain('zh-TW');
    expect(values).not.toContain('zh');
  });
});

describe('getAutoTranscriptionPrompt', () => {
  it('returns a Simplified-script prompt for zh-CN', () => {
    expect(getAutoTranscriptionPrompt('zh-CN')).toBe('以下是普通话的句子。');
  });

  it('returns a Traditional-script prompt for zh-TW', () => {
    expect(getAutoTranscriptionPrompt('zh-TW')).toBe('以下是普通話的句子。');
  });

  it('returns undefined for non-Chinese languages and auto detect', () => {
    expect(getAutoTranscriptionPrompt('en')).toBeUndefined();
    expect(getAutoTranscriptionPrompt('')).toBeUndefined();
  });
});

describe('migrateSpeechLanguage', () => {
  it('migrates stored openai zh to zh-CN and injects the Simplified prompt', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', language: 'zh', model: 'whisper-1' },
    });
    const migrated = migrateSpeechLanguage(config);
    expect(migrated.openai?.language).toBe('zh-CN');
    expect(migrated.openai?.prompt).toBe('以下是普通话的句子。');
  });

  it('leaves non-zh languages and existing prompts untouched', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', language: 'zh-TW', model: 'whisper-1', prompt: '以下是普通話的句子。' },
    });
    const migrated = migrateSpeechLanguage(config);
    expect(migrated).toBe(config);
    expect(migrated.openai?.language).toBe('zh-TW');
    expect(migrated.openai?.prompt).toBe('以下是普通話的句子。');
  });
});

describe('normalizeSpeechToTextConfig', () => {
  it('fills the hosted default for a completely missing config', () => {
    const config = normalizeSpeechToTextConfig(undefined);
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe('hosted');
    expect(config.openai?.model).toBe('gpt-4o-transcribe');
  });

  it('preserves stored values over defaults', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'k', model: 'whisper-1' },
    });
    expect(config.openai?.model).toBe('whisper-1');
    expect(config.enabled).toBe(true);
  });

  it('fills defaults for an explicitly empty openai sub-config', () => {
    const config = normalizeSpeechToTextConfig({ enabled: false, provider: 'openai', openai: {} as never });
    expect(config.openai?.model).toBe('gpt-4o-transcribe');
  });
});
