/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Failure classification for a media generation attempt.
 *
 * Lives under `common/` because two very different consumers need the *same*
 * judgement and must not drift apart:
 *
 * - the renderer, to pick the advice line on a failed card
 *   (`useMediaFailureAdvice`), and
 * - the Form C adapter, to decide whether a submission failure is worth
 *   retrying under a different protocol (`taskPollAdapter`).
 *
 * A second copy of these patterns would mean the UI could say "this gateway
 * does not route that API" while the executor did not act on it, or the reverse.
 *
 * **Matching is on error text, which is guessing.** That is acceptable for an
 * advice line (cost of a wrong match: one unhelpful sentence) and for choosing
 * a retry (cost: one extra request against a path that answers in
 * milliseconds). It must never gate a capability — same rule the model-kind
 * labels follow.
 */

export type MediaFailureClass =
  /** The gateway does not route this generation API at all. */
  | 'notRouted'
  /** The gateway routes the call but does not know this model. */
  | 'modelNotFound'
  | 'auth'
  | 'rateLimit'
  | 'timeout'
  | 'contentPolicy';

/**
 * Classify a raw upstream error.
 *
 * Order matters: `notRouted` is checked first because its signature (an empty
 * body) is specific and its remedy is the only one that is not "try again" —
 * no retry and no key change will ever make an unrouted path work.
 */
export const classifyMediaFailure = (error: string | undefined): MediaFailureClass | null => {
  if (!error) return null;
  const e = error.toLowerCase();

  if (
    e.includes('empty body') ||
    e.includes('does not route') ||
    // A bare "404 ... (no body)" from the OpenAI SDK is what a wrong host/path
    // combination looks like: the server answered, but nothing at that path
    // knows this API — same remedy as an empty-body 200, wrong endpoint choice
    // rather than a bad model name or key. Real "model not found" 404s carry a
    // JSON body and are caught by the modelNotFound check instead.
    (e.includes('404') && e.includes('no body'))
  )
    return 'notRouted';
  if (/model .*not found|no such model|model_not_found|unknown model/.test(e)) return 'modelNotFound';
  if (/\b401\b|\b403\b|unauthorized|invalid api key|invalid_api_key|authentication/.test(e)) return 'auth';
  if (/\b429\b|rate limit|too many requests|quota/.test(e)) return 'rateLimit';
  if (/timeout|timed out/.test(e)) return 'timeout';
  if (/content policy|content_policy|safety|sensitive|moderation|violat/.test(e)) return 'contentPolicy';
  return null;
};
