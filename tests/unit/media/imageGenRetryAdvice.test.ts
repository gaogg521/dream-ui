/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { retryAdvice } from '@process/resources/builtinMcp/imageGenServer';

/**
 * Real incident this covers: an edit request failed with the image service's
 * own `400 LLM Provider NOT provided`. The agent read that as a bad file path,
 * retried with a relative path, got an ENOENT that looked like confirmation,
 * then retried the original absolute path for the same 400 — three paid calls,
 * and the user was told it was "a temporary service problem".
 */
describe('retryAdvice', () => {
  it('tells the model an upstream rejection is not a path problem', () => {
    const advice = retryAdvice(
      '400 BadRequestError: LLM Provider NOT provided. You passed model=agnes-image-2.5-flash'
    );
    expect(advice).toContain('not a problem with the file path');
    expect(advice).toMatch(/do NOT retry with a different path/i);
  });

  it.each([
    '401 Unauthorized',
    '403 forbidden',
    '429 rate limited',
    '500 internal error',
    'invalid api key',
    'quota exceeded',
  ])('treats %s as an upstream failure', (detail) => {
    expect(retryAdvice(detail)).toContain('not a problem with the file path');
  });

  it('points a genuine missing file back at the exact returned path', () => {
    const advice = retryAdvice("ENOENT: no such file or directory, open 'C:wsdream-temp-1dream-temp-1outputsimg.png'");
    expect(advice).toContain('absolute path exactly as a previous call returned it');
    expect(advice).not.toContain('not a problem with the file path');
  });

  it('says nothing when the failure is neither', () => {
    expect(retryAdvice('generation failed')).toBe('');
  });
});
