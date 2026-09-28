/**
 * Copyright 2026 One Work
 */

/**
 * 'hosted' is the broker-backed default (mode D): the backend resolves this
 * install's id and forwards the audio itself, so no sub-config is needed —
 * see `crates/dream-core-shell/src/stt_hosted.rs`.
 */
export type SpeechToTextProvider = 'openai' | 'hosted';

export type OpenAISpeechToTextConfig = {
  api_key: string;
  base_url?: string;
  language?: string;
  model: string;
  prompt?: string;
  temperature?: number;
};

export type SpeechToTextConfig = {
  autoSend?: boolean;
  enabled: boolean;
  /** Existing model-channel ID to resolve on the backend, without copying its secret here. */
  modelProviderId?: string;
  provider: SpeechToTextProvider;
  openai?: OpenAISpeechToTextConfig;
};

export type SpeechToTextAudioBuffer = Uint8Array | number[] | Record<string, number>;

export type SpeechToTextRequest = {
  audioBuffer: SpeechToTextAudioBuffer;
  file_name: string;
  languageHint?: string;
  mimeType: string;
};

export type SpeechToTextResult = {
  language?: string;
  model: string;
  provider: SpeechToTextProvider;
  text: string;
};
