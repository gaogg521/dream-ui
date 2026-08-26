/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Classifying a failure is guessing at error text, so the rule that keeps it
 * honest is pinned here: it must stay silent when it does not recognize the
 * failure. Generic advice under an error that will never succeed ("try again
 * later" on an unrouted endpoint) sends the user in circles, which is worse
 * than the dead end it replaced.
 */

import { describe, expect, it } from 'vitest';
import { classifyMediaFailure } from '@renderer/hooks/media/useMediaFailureAdvice';

describe('classifyMediaFailure', () => {
  it('recognizes an unrouted endpoint from the empty-body signature', () => {
    expect(
      classifyMediaFailure(
        'Ark task submission failed: the endpoint returned HTTP 200 with an empty body, which is how this gateway answers a path it does not route.'
      )
    ).toBe('notRouted');
  });

  /**
   * A bare "404 (no body)" is the OpenAI SDK's phrasing when a request lands
   * on a path the host simply does not have — the real-world shape of picking
   * a `media_endpoint` style whose route (e.g. `/api/seedream/v1/`) does not
   * exist on the provider's actual host. Reproduced 2026-08-10 against a real
   * Volcengine Ark deployment.
   */
  it('recognizes an unrouted endpoint from a bare 404 with no body', () => {
    expect(classifyMediaFailure('404 status code (no body)')).toBe('notRouted');
  });

  it('recognizes a model the channel does not serve', () => {
    expect(classifyMediaFailure('{"error":{"message":"model \\"seedance-2-0-fast\\" not found"}}')).toBe(
      'modelNotFound'
    );
  });

  it('recognizes rejected credentials', () => {
    expect(classifyMediaFailure('HTTP 401 — invalid api key')).toBe('auth');
  });

  it('recognizes throttling', () => {
    expect(classifyMediaFailure('HTTP 429 — rate limit exceeded')).toBe('rateLimit');
  });

  it('recognizes a timeout', () => {
    expect(classifyMediaFailure('timeout')).toBe('timeout');
  });

  it('recognizes a moderation block', () => {
    expect(classifyMediaFailure('Your request was rejected by our safety system')).toBe('contentPolicy');
  });

  /**
   * `notRouted` must win over the others: it is the only class whose remedy is
   * not "try again", and an unrouted-path message can easily also mention the
   * model name.
   */
  it('prefers the unrouted diagnosis when a message could read as either', () => {
    expect(classifyMediaFailure('generation for model "seedance-2-0-fast" failed: HTTP 200 with an empty body')).toBe(
      'notRouted'
    );
  });

  it('stays silent on a failure it does not recognize', () => {
    expect(classifyMediaFailure('ECONNRESET while reading the response stream')).toBeNull();
    expect(classifyMediaFailure('')).toBeNull();
    expect(classifyMediaFailure(undefined)).toBeNull();
  });
});
