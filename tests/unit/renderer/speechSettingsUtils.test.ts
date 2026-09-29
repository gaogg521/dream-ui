/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPEECH_TO_TEXT_CONFIG,
  OFFICIAL_OPENAI_BASE_URL,
  OPENAI_SPEECH_MODEL_PRESETS,
  SPEECH_LANGUAGE_OPTIONS,
  applySpeechSource,
  buildModelOptions,
  deriveSpeechSource,
  getAutoTranscriptionPrompt,
  isValidHttpUrl,
  migrateLegacySpeechSource,
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
      openai: { api_key: '', base_url: '  ', model: 'whisper-1' },
    });
    expect(deriveSpeechSource(config)).toBe('hosted');
  });

  // The removed "OpenAI (official)" source still transcribes against
  // api.openai.com with the stored key. Showing it as the hosted default would
  // hide a credential with nowhere left in the UI to see or edit it.
  it('returns custom for a stored key with no base_url, not hosted', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'sk-real', base_url: '', model: 'gpt-4o-transcribe' },
    });
    expect(deriveSpeechSource(config)).toBe('custom');
  });
});

describe('migrateLegacySpeechSource', () => {
  // Exactly what a shipped 3.0.x install persisted the moment the user flipped
  // the speech master switch. Left alone it reads as hosted in the panel while
  // the backend sends it to api.openai.com with no key.
  it('rewrites the abandoned official-OpenAI default to the hosted provider', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: '', base_url: '', language: '', model: 'gpt-4o-transcribe' },
    });
    const migrated = migrateLegacySpeechSource(config);
    expect(migrated.provider).toBe('hosted');
    expect(deriveSpeechSource(migrated)).toBe('hosted');
  });

  it('keeps a working official-OpenAI key by pointing it at the official URL', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: 'sk-real', base_url: '', model: 'gpt-4o-transcribe' },
    });
    const migrated = migrateLegacySpeechSource(config);
    expect(migrated.openai?.api_key).toBe('sk-real');
    expect(migrated.openai?.base_url).toBe(OFFICIAL_OPENAI_BASE_URL);
    expect(deriveSpeechSource(migrated)).toBe('custom');
  });

  it('leaves a custom endpoint, a model-settings channel and a hosted config untouched', () => {
    const custom = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      openai: { api_key: '', base_url: 'https://my-host/v1', model: 'whisper-1' },
    });
    const modelSettings = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'openai',
      modelProviderId: 'openrouter',
      openai: { api_key: '', base_url: '', model: 'qwen/qwen3-asr-0.6b' },
    });
    const hosted = normalizeSpeechToTextConfig({ enabled: true, provider: 'hosted' });

    expect(migrateLegacySpeechSource(custom)).toBe(custom);
    expect(migrateLegacySpeechSource(modelSettings)).toBe(modelSettings);
    expect(migrateLegacySpeechSource(hosted)).toBe(hosted);
  });

  // The two old sources kept separate sub-configs, so a Deepgram user who had
  // previously tried a custom OpenAI endpoint still carries that base_url. The
  // backend resolves `provider: 'deepgram'` to hosted regardless of it; reading
  // it as "custom" here would put the panel and the backend back out of sync.
  it('sends a removed provider to hosted even when a stale openai base_url is stored', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: true,
      provider: 'deepgram' as never,
      openai: { api_key: '', base_url: 'https://old-host/v1', model: 'whisper-1' },
    });
    const migrated = migrateLegacySpeechSource(config);
    expect(migrated.provider).toBe('hosted');
    expect(deriveSpeechSource(migrated)).toBe('hosted');
  });

  it('sends a removed provider with no openai sub-config to hosted', () => {
    const config = normalizeSpeechToTextConfig({ enabled: true, provider: 'deepgram' as never });
    expect(migrateLegacySpeechSource(config).provider).toBe('hosted');
  });

  it('does not re-enable a feature the user switched off', () => {
    const config = normalizeSpeechToTextConfig({
      enabled: false,
      provider: 'openai',
      openai: { api_key: '', base_url: '', model: 'gpt-4o-transcribe' },
    });
    expect(migrateLegacySpeechSource(config).enabled).toBe(false);
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
