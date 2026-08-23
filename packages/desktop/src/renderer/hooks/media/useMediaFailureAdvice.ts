/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "What do I do about this?" for a failed generation.
 *
 * The card already attributes the upstream error honestly, but an attributed
 * error is still a dead end: it says what went wrong, never what to try. This
 * maps the failure classes we can actually recognize onto one concrete next
 * step.
 *
 * **Matching is on error text, which is guessing — so it is display only.**
 * Same split the model-kind labels use: a guess may inform, never gate. The
 * cost of a wrong match here is one unhelpful sentence; the cost of a wrong
 * guess in a gate is a capability the user cannot reach. And an unrecognized
 * failure returns nothing rather than generic filler, because "try again later"
 * under an error that will never succeed is worse than silence.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

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

/** The advice line for a failed job, or null when we do not recognize why. */
export const useMediaFailureAdvice = (error: string | undefined): string | null => {
  const { t } = useTranslation();
  return useMemo(() => {
    const failure = classifyMediaFailure(error);
    if (!failure) return null;
    return t(`conversation.mediaFailureAdvice_${failure}` as never);
  }, [error, t]);
};
