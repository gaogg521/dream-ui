/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TFunction } from 'i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';

/**
 * A send (or model switch) the company's policy refused: content rules (T4),
 * the spend budget, or the model allowlist (P1-2).
 *
 * Matched on `code`, never on the message text. The text is prose — it gets
 * reworded, and for content rules it embeds an admin-authored rule name that is
 * also translated. Substring matching on any of that breaks the first time
 * someone renames a rule.
 *
 * The backend sends an English sentence plus the parameters that sentence was
 * built from. We render our own translated sentence from the parameters and keep
 * the English only as a fallback — for a code we don't know yet (an older
 * client against a newer server), or when the parameters are missing.
 *
 * Falling back to `null` rather than to a generic string is deliberate: the
 * caller then keeps whatever error handling it already had.
 */
const DENIAL_MESSAGE_KEYS = {
  CONTENT_BLOCKED: { key: 'conversation.policyDenied_contentBlocked', params: ['ruleName'] },
  BUDGET_EXCEEDED: { key: 'conversation.policyDenied_budgetExceeded', params: [] },
  MODEL_NOT_ALLOWED: { key: 'conversation.policyDenied_modelNotAllowed', params: ['model'] },
  POLICY_CHECK_FAILED: { key: 'conversation.policyDenied_checkFailed', params: [] },
  // T6-4: not a rule the admin configured — the seat cap is full. Distinct
  // copy on purpose: "wait for the budget window" (BUDGET_EXCEEDED) and "ask
  // for a seat" are different asks for the reader.
  SEAT_LIMIT_EXCEEDED: { key: 'conversation.policyDenied_seatLimitExceeded', params: [] },
  // T7: a tighter cap layered under BUDGET_EXCEEDED, scoped to the sender's
  // department. Distinct copy so the reader knows to look at their
  // department's budget, not the company-wide one.
  DEPARTMENT_BUDGET_EXCEEDED: { key: 'conversation.policyDenied_departmentBudgetExceeded', params: [] },
} as const satisfies Record<string, { key: string; params: readonly string[] }>;

type DenialCode = keyof typeof DENIAL_MESSAGE_KEYS;

const isDenialCode = (code: string): code is DenialCode => code in DENIAL_MESSAGE_KEYS;

const readStringParams = (details: unknown, names: readonly string[]): Record<string, string> | null => {
  if (names.length === 0) return {};
  if (details === null || typeof details !== 'object') return null;

  const source = details as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = source[name];
    // A blank rule name would render "（规则：）" — worse than the English
    // sentence, which at least reads as a complete thought.
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    out[name] = value;
  }
  return out;
};

/**
 * The message to show for a policy refusal, or `null` when this is some other
 * error. `t` is the caller's translator; pass it so this stays a pure function.
 */
export const getPolicyDenialMessage = (error: unknown, t: TFunction): string | null => {
  if (!isBackendHttpError(error)) return null;
  if (error.status !== 403) return null;

  const englishFallback = error.backendMessage.trim();

  if (isDenialCode(error.code)) {
    const { key, params } = DENIAL_MESSAGE_KEYS[error.code];
    const values = readStringParams(error.details, params);
    if (values) return t(key, values);
  } else if (!englishFallback) {
    // Unknown code and nothing to say — let the caller's own handling run
    // rather than showing a blank toast.
    return null;
  }

  return englishFallback.length > 0 ? englishFallback : null;
};
