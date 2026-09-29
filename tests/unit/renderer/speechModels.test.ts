/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { looksLikeTranscriptionModel, sortModelsForTranscription } from '@renderer/services/speech/speechModels';

describe('looksLikeTranscriptionModel', () => {
  it('matches the transcription families a provider list actually contains', () => {
    // Real ids taken from Aliyun's and OpenAI's live /v1/models responses.
    for (const model of [
      'whisper-1',
      'gpt-4o-transcribe',
      'qwen3-asr-flash',
      'fun-asr-flash-2026-06-15',
      'qwen-audio-3.0-asr-flash',
      'SenseVoiceSmall',
      'paraformer-realtime-v2',
    ]) {
      expect(looksLikeTranscriptionModel(model), model).toBe(true);
    }
  });

  // The media catalog's broader `audio` hint also matches these; for a
  // speech-to-text picker they are wrong answers, not near misses.
  it('does not match text-to-speech or chat models', () => {
    for (const model of ['qwen-audio-3.1-tts-next', 'tts-1-hd', 'gpt-4o-mini-tts', 'qwen3.8-max', 'glm-5.3-flash']) {
      expect(looksLikeTranscriptionModel(model), model).toBe(false);
    }
  });
});

describe('sortModelsForTranscription', () => {
  it('floats likely transcription models without dropping anything', () => {
    const fetched = ['qwen3.8-max', 'qwen3-asr-flash', 'tts-1', 'whisper-1'];
    expect(sortModelsForTranscription(fetched)).toEqual(['qwen3-asr-flash', 'whisper-1', 'qwen3.8-max', 'tts-1']);
  });

  it('keeps the provider order inside each group', () => {
    const fetched = ['b-asr', 'a-asr', 'z-chat', 'y-chat'];
    expect(sortModelsForTranscription(fetched)).toEqual(['b-asr', 'a-asr', 'z-chat', 'y-chat']);
  });

  it('handles an endpoint that lists nothing', () => {
    expect(sortModelsForTranscription([])).toEqual([]);
  });
});
