/**
 * Copyright 2026 One Work
 */

import type { SpeechToTextConfig } from '@/common/types/provider/speech';
export { OPENAI_SPEECH_MODEL_PRESETS } from '@renderer/services/speech/speechModels';
export {
  DEFAULT_SPEECH_TO_TEXT_CONFIG,
  normalizeSpeechToTextConfig,
} from '@renderer/services/speech/speechConfigDefaults';
import { DEFAULT_SPEECH_TO_TEXT_CONFIG } from '@renderer/services/speech/speechConfigDefaults';

/**
 * UI-level service source. 'custom' is stored as provider:'openai' with a
 * non-empty base_url. 'hosted' is the broker-backed default (mode D) — no
 * sub-config, works with no setup, and is what a user who has never touched
 * this panel gets (see `DEFAULT_SPEECH_TO_TEXT_CONFIG`).
 */
export type SpeechSource = 'custom' | 'modelSettings' | 'hosted';

/** Language autonyms are intentionally not translated. Empty value = auto detect. */
export const SPEECH_LANGUAGE_OPTIONS: Array<{ value: string; label?: string }> = [
  { value: '' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'zh-TW', label: '中文（繁體）' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'uk', label: 'Українська' },
];

/**
 * Whisper-family models do not distinguish Simplified/Traditional Chinese for
 * `language=zh`; a same-script prompt steers the output script.
 */
export const AUTO_TRANSCRIPTION_PROMPTS: Record<string, string> = {
  'zh-CN': '以下是普通话的句子。',
  'zh-TW': '以下是普通話的句子。',
};

export const getAutoTranscriptionPrompt = (language: string): string | undefined =>
  AUTO_TRANSCRIPTION_PROMPTS[language];

/**
 * Phase 1 stored the ambiguous 'zh' language: migrate it to 'zh-CN' (and
 * inject the matching OpenAI script prompt).
 */
export const migrateSpeechLanguage = (config: SpeechToTextConfig): SpeechToTextConfig => {
  if (config.openai?.language === 'zh') {
    return {
      ...config,
      openai: { ...config.openai, language: 'zh-CN', prompt: getAutoTranscriptionPrompt('zh-CN') },
    };
  }
  return config;
};

/**
 * The official OpenAI transcription endpoint. Only used to migrate a config
 * left behind by the removed "OpenAI (official)" source — see
 * `migrateLegacySpeechSource`.
 */
export const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const deriveSpeechSource = (config: SpeechToTextConfig): SpeechSource => {
  if (config.modelProviderId?.trim()) {
    return 'modelSettings';
  }
  if (config.provider === 'hosted') {
    return 'hosted';
  }
  // A stored key with no base_url is the removed "OpenAI (official)" source.
  // It still transcribes against api.openai.com, so it must NOT be displayed
  // as the hosted default — that would hide a credential the user can no
  // longer see or edit anywhere in the UI.
  if (config.openai?.api_key?.trim()) {
    return 'custom';
  }
  return config.openai?.base_url?.trim() ? 'custom' : 'hosted';
};

/**
 * Rewrite a config left behind by a source this build no longer offers.
 *
 * Shipped 3.0.x releases persisted `provider: 'openai'` with a blank base_url
 * (the old default, written the moment the master switch was flipped) and
 * `provider: 'deepgram'`. Both name a source that is gone. Without this the
 * panel derives them to a source whose stored shape disagrees with it, and the
 * backend — which reads the stored shape, not the panel — rejects every
 * transcription.
 *
 * Applied at load next to `migrateSpeechLanguage`; it reaches storage on the
 * user's next edit. The backend performs the same substitution independently,
 * so the microphone works before that happens.
 */
export const migrateLegacySpeechSource = (config: SpeechToTextConfig): SpeechToTextConfig => {
  if (config.modelProviderId?.trim() || config.provider === 'hosted') {
    return config;
  }

  // `provider` is whatever a previous release persisted, not whatever the
  // current union says: a 3.0.x install that used Deepgram still has
  // `provider: 'deepgram'` on disk. That names a source this build cannot
  // serve at all, so it goes to hosted no matter what the openai sub-config
  // happens to hold — the two sources kept separate sub-configs, so a former
  // Deepgram user can still carry a stale OpenAI base_url. Reading that stale
  // value as "custom" here is exactly the front/back split this migration
  // exists to close: the backend resolves the same config to hosted.
  const storedProvider: string = config.provider;
  if (storedProvider !== 'openai') {
    return applySpeechSource(config, 'hosted');
  }

  // Keep a working official-OpenAI setup working, as a custom endpoint
  // pointed at the URL it was already using.
  if (!config.openai?.base_url?.trim() && config.openai?.api_key?.trim()) {
    return { ...config, provider: 'openai', openai: { ...config.openai, base_url: OFFICIAL_OPENAI_BASE_URL } };
  }
  if (config.openai?.base_url?.trim()) {
    return config;
  }
  return applySpeechSource(config, 'hosted');
};

/**
 * Apply a UI source choice onto the stored config shape.
 * `rememberedCustomBaseUrl` restores the last custom URL within the session
 * after the user toggles hosted -> custom.
 */
export const applySpeechSource = (
  config: SpeechToTextConfig,
  source: SpeechSource,
  rememberedCustomBaseUrl = ''
): SpeechToTextConfig => {
  if (source === 'custom') {
    const currentBaseUrl = config.openai?.base_url?.trim() ? config.openai.base_url : rememberedCustomBaseUrl;
    return {
      ...config,
      modelProviderId: undefined,
      provider: 'openai',
      openai: { ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai, ...config.openai, base_url: currentBaseUrl },
    };
  }
  if (source === 'modelSettings') {
    return { ...config, provider: 'openai' };
  }
  return {
    ...config,
    modelProviderId: undefined,
    provider: 'hosted',
    openai: { ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai, ...config.openai, base_url: '' },
  };
};

/** Strict Select would hide a stored non-preset model; surface it as an extra option. */
export const buildModelOptions = (presets: string[], currentModel?: string): string[] => {
  const model = currentModel?.trim();
  if (!model || presets.includes(model)) {
    return [...presets];
  }
  return [...presets, model];
};

export const isValidHttpUrl = (value: string): boolean => {
  if (!value.trim()) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
