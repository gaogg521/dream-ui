/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isSilentRecording } from '@renderer/hooks/system/useSpeechInput';

describe('isSilentRecording', () => {
  // The case this exists for: the user tapped the microphone and said
  // nothing. The hosted default's model rejects such a clip outright, so
  // catching it here keeps it the quiet no-op it has always been.
  it('treats a measured, essentially silent recording as silent', () => {
    expect(isSilentRecording(0)).toBe(true);
    expect(isSilentRecording(0.001)).toBe(true);
  });

  // "Never measured" must not be read as "measured and heard nothing":
  // when the analyser fails to start, refusing to upload would drop real
  // speech with no way for the user to tell why.
  it('never skips a recording whose level was never measured', () => {
    expect(isSilentRecording(null)).toBe(false);
  });

  // Well below normal speech, so the threshold must not reach up into it.
  // Anything that does slip through still transcribes: the broker retries a
  // rejected clip on a model that reports silence cleanly.
  it('does not treat quiet speech as silence', () => {
    expect(isSilentRecording(0.006)).toBe(false);
    expect(isSilentRecording(0.05)).toBe(false);
    expect(isSilentRecording(0.4)).toBe(false);
  });
});
