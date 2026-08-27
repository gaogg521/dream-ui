/**
 * @license
 * Copyright 2026 1ONE
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
 * The classification itself moved to `common/media/failureClass` once the Form
 * C adapter started acting on the same judgement (auto-retrying a `notRouted`
 * submission under the sibling protocol). One copy, so the sentence the user
 * reads and the decision the executor makes can never disagree. Re-exported
 * here because this is where callers already look for it.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyMediaFailure, type MediaFailureClass } from '@/common/media/failureClass';

export { classifyMediaFailure };
export type { MediaFailureClass };

/** The advice line for a failed job, or null when we do not recognize why. */
export const useMediaFailureAdvice = (error: string | undefined): string | null => {
  const { t } = useTranslation();
  return useMemo(() => {
    const failure = classifyMediaFailure(error);
    if (!failure) return null;
    return t(`conversation.mediaFailureAdvice_${failure}` as never);
  }, [error, t]);
};
