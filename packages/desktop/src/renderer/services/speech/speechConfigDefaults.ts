/**
 * Copyright 2026 One Work
 */

import type { SpeechToTextConfig } from '@/common/types/provider/speech';

/**
 * A user who has never touched the speech settings panel gets the hosted
 * broker-backed default, already enabled — no key, no setup. Shared between
 * the settings panel (to show the right selected state) and the chat mic
 * button (to know the mic is usable with zero configuration): both must
 * agree on what "no stored config yet" means, or the button would show
 * "not configured" while settings shows it active.
 */
export const DEFAULT_SPEECH_TO_TEXT_CONFIG: SpeechToTextConfig = {
  enabled: true,
  provider: 'hosted',
  openai: {
    api_key: '',
    base_url: '',
    language: '',
    model: 'gpt-4o-transcribe',
  },
};

export const normalizeSpeechToTextConfig = (config?: Partial<SpeechToTextConfig>): SpeechToTextConfig => ({
  ...DEFAULT_SPEECH_TO_TEXT_CONFIG,
  ...config,
  openai: {
    ...DEFAULT_SPEECH_TO_TEXT_CONFIG.openai,
    ...config?.openai,
  },
});
