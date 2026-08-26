/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { getPolicyDenialMessage } from '@/renderer/pages/conversation/platforms/policyDenialError';

const REASON = "Blocked by your company's content policy (rule: 合同关键词). Remove the flagged content and try again.";

const backendError = (status: number, body: unknown) =>
  new BackendHttpError({ method: 'POST', path: '/api/conversations/c1/messages', status, body });

/** Stands in for i18next: echoes the key and the values it was handed. */
const t = vi.fn((key: string, values?: Record<string, string>) =>
  values && Object.keys(values).length > 0 ? `${key}::${JSON.stringify(values)}` : key
) as unknown as Parameters<typeof getPolicyDenialMessage>[1];

describe('getPolicyDenialMessage', () => {
  it('renders a translated sentence from the rule name rather than showing English', () => {
    const error = backendError(403, {
      success: false,
      error: REASON,
      code: 'CONTENT_BLOCKED',
      details: { ruleName: '合同关键词' },
    });

    // The whole reason the rule name travels as a parameter: a Chinese UI must
    // not have to paste an English sentence in the middle of itself.
    expect(getPolicyDenialMessage(error, t)).toBe(
      'conversation.policyDenied_contentBlocked::{"ruleName":"合同关键词"}'
    );
  });

  it('translates budget and allowlist refusals too', () => {
    const budget = backendError(403, { success: false, error: 'budget reached', code: 'BUDGET_EXCEEDED' });
    expect(getPolicyDenialMessage(budget, t)).toBe('conversation.policyDenied_budgetExceeded');

    const model = backendError(403, {
      success: false,
      error: "Model 'gpt-9' is not allowed",
      code: 'MODEL_NOT_ALLOWED',
      details: { model: 'gpt-9' },
    });
    expect(getPolicyDenialMessage(model, t)).toBe('conversation.policyDenied_modelNotAllowed::{"model":"gpt-9"}');
  });

  it('falls back to the English sentence when the parameters are missing', () => {
    // An older server that has the code but not yet the details.
    const error = backendError(403, { success: false, error: REASON, code: 'CONTENT_BLOCKED' });

    expect(getPolicyDenialMessage(error, t)).toBe(REASON);
  });

  it('falls back rather than rendering a blank rule name', () => {
    const error = backendError(403, {
      success: false,
      error: REASON,
      code: 'CONTENT_BLOCKED',
      details: { ruleName: '   ' },
    });

    // "（规则：）" reads as a bug; the English sentence at least reads as a
    // complete thought.
    expect(getPolicyDenialMessage(error, t)).toBe(REASON);
  });

  it('falls back to the English sentence for a code this client does not know', () => {
    // A newer server adding a refusal kind must not silence the message.
    const error = backendError(403, { success: false, error: 'Refused for some new reason', code: 'SOME_FUTURE_CODE' });

    expect(getPolicyDenialMessage(error, t)).toBe('Refused for some new reason');
  });

  it('never shows error.message, which is a JSON dump of the whole response', () => {
    const error = backendError(403, {
      success: false,
      error: REASON,
      code: 'CONTENT_BLOCKED',
      details: { ruleName: '合同关键词' },
    });

    // The regression this guards: showing `error.message` puts
    // `Backend POST /api/... failed (403): {"success":false,...}` in front of a
    // non-technical user.
    expect(error.message).toContain('Backend POST');
    expect(getPolicyDenialMessage(error, t)).not.toContain('Backend POST');
  });

  it('ignores non-403 responses and non-backend errors', () => {
    expect(getPolicyDenialMessage(backendError(409, { code: 'CONTENT_BLOCKED' }), t)).toBeNull();
    expect(getPolicyDenialMessage(new Error('boom'), t)).toBeNull();
    expect(getPolicyDenialMessage(undefined, t)).toBeNull();
  });

  it('returns null for a 403 with nothing to say, so the caller keeps its own handling', () => {
    expect(
      getPolicyDenialMessage(backendError(403, { success: false, error: '   ', code: 'FORBIDDEN' }), t)
    ).toBeNull();
  });
});
