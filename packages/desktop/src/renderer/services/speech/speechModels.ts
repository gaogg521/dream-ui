/**
 * Copyright 2026 One Work
 */

/** Models valid for the file-based /audio/transcriptions endpoint and the streaming /api/stt/stream endpoint. */
export const OPENAI_SPEECH_MODEL_PRESETS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'];

/**
 * Names that look like a speech-to-text model.
 *
 * Deliberately narrower than the media catalog's `audio` hint
 * (`common/media/catalog/resolve.ts`), which also matches `tts`, `voice` and
 * `realtime` — correct for "is this an audio model", wrong for a transcription
 * picker, where offering a text-to-speech model is just a failed request with
 * extra steps.
 *
 * A name is the only signal available: an OpenAI-compatible `/v1/models`
 * returns bare ids, and even a vendor's own richer catalog need not carry
 * modality (Aliyun's model list has a `features` array, and its ASR models
 * declare `[]` there, same as its TTS models). So this ranks the list — it
 * never hides anything, and it never claims a model will work.
 */
const TRANSCRIPTION_NAME_HINT = /(asr|whisper|transcri|speech[-_]?to[-_]?text|stt|sensevoice|paraformer|gummy)/i;

export const looksLikeTranscriptionModel = (model: string): boolean => TRANSCRIPTION_NAME_HINT.test(model);

/**
 * Order a fetched model list for the transcription picker: likely matches
 * first, everything else after, each group keeping the provider's own order.
 */
export const sortModelsForTranscription = (models: string[]): string[] => [
  ...models.filter(looksLikeTranscriptionModel),
  ...models.filter((model) => !looksLikeTranscriptionModel(model)),
];
