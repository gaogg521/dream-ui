/**
 * Turn a thrown error from an enterprise/company admin call into text safe to
 * show a user. Plain `String(e)` on a `BackendHttpError` dumps the whole wire
 * response (`Backend PUT ... failed (403): {"success":false,...}`) — this
 * extracts the backend's own human message instead, and further replaces the
 * license-gate wire text ("X is not included in the current plan", emitted by
 * one-sso / one-org for several Feature::* gates) with a translated hint that
 * also says what to do about it.
 */

import type { TFunction } from 'i18next';
import { isBackendHttpError } from '@/common/adapter/httpBridge';

const PLAN_GATE_PATTERN = /not included in the current plan/i;

export function friendlyEnterpriseError(e: unknown, t: TFunction): string {
  if (isBackendHttpError(e) && e.backendMessage) {
    if (PLAN_GATE_PATTERN.test(e.backendMessage)) {
      return t('common.enterprise.planGateHint', {
        defaultValue:
          '当前企业套餐不包含该功能，请联系企业管理员在「企业管理后台 → 订阅与用量」激活支持的授权码后重试。',
      });
    }
    return e.backendMessage;
  }
  return String(e);
}
