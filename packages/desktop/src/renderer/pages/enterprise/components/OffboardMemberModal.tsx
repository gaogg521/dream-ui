/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Offboarding a member — the one dialog, shared by the two places that start it
 * (P0-2 / P1-2, and T6's departed list).
 *
 * ⚠️ Why it has two modes rather than one flow:
 *
 * Removal is **project-group scoped**. The backend acts on the caller's active
 * group, refuses a user who is not in it, and a resource hand-over additionally
 * requires the recipient to be in that same group. Company membership is a
 * separate tier above it (企业 ⊃ 项目组), and the directory's departed list is
 * company-scoped — so a departed person may well be in no group the admin is
 * standing in, or in none at all.
 *
 * - `project-group` — the full, already-proven flow: count what they own, offer
 *   a hand-over, remove from the group, then release the company seat.
 * - `company-only` — nothing can be handed over from here, so the dialog says
 *   so and names the groups that still have to be dealt with, then does the one
 *   thing this admin genuinely has authority for: release the seat and cut off
 *   their credentials.
 *
 * Firing the project-group calls when the person is not in the group would fail
 * with a raw backend error and leave the seat occupied, which is the outcome
 * both modes exist to avoid.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Message, Modal, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { DepartedTenantRef } from '@/common/types/org/orgTypes';

export type OffboardMode = 'project-group' | 'company-only';

export type OffboardTarget = {
  userId: string;
  displayName: string;
  /** Known only from the directory entry point; drives the company-only copy. */
  tenants?: DepartedTenantRef[];
};

type OffboardMemberModalProps = {
  /** `null` closes the dialog. */
  target: OffboardTarget | null;
  mode: OffboardMode;
  /** Hand-over recipients. Ignored in company-only mode. */
  candidates: { userId: string; label: string }[];
  onCancel: () => void;
  onDone: (userId: string) => void;
};

const OffboardMemberModal: React.FC<OffboardMemberModalProps> = ({ target, mode, candidates, onCancel, onDone }) => {
  const { t } = useTranslation();
  /** `null` while still counting, so the dialog can say "checking" rather than "0". */
  const [ownedCount, setOwnedCount] = useState<number | null>(null);
  const [transferTo, setTransferTo] = useState<string>('');
  const [working, setWorking] = useState(false);

  // Keyed on the id, not the object: a parent that rebuilds `target` each
  // render would otherwise re-run this forever.
  const targetUserId = target?.userId ?? null;

  useEffect(() => {
    setTransferTo('');
    setOwnedCount(null);
    if (!targetUserId || mode !== 'project-group') return;
    let alive = true;
    // Best-effort: if the count fails the dialog still works, it just cannot
    // warn about resources. Treat that as "unknown", not "none".
    void ipcBridge.oneDevops.countOwnedResources
      .invoke({ userId: targetUserId })
      .then((n) => {
        if (alive) setOwnedCount(typeof n === 'number' ? n : 0);
      })
      .catch(() => {
        if (alive) setOwnedCount(0);
      });
    return () => {
      alive = false;
    };
  }, [targetUserId, mode]);

  const handleOk = useCallback(async () => {
    if (!target) return;
    setWorking(true);
    try {
      if (mode === 'project-group') {
        // Transfer BEFORE removal: `transfer_ownership` requires the recipient
        // to be a member of the group, and doing it after would race the
        // removal.
        if (transferTo) {
          const moved = await ipcBridge.oneDevops.transferOwnership.invoke({
            fromUserId: target.userId,
            toUserId: transferTo,
          });
          Message.success(t('common.enterprise.transferDone', { count: moved ?? 0 }));
        }
        // Releasing the company seat (if this was the member's last project
        // group under a company) now happens automatically on the backend —
        // see `OrgService::remove_member` / `CompanySeatSync::release_company_member`.
        // It used to require this modal to separately call
        // `removeCompanyMember` right after, but that call was
        // unconditional: for a Phase-2 multi-group member it would release
        // their seat even when they still belonged to another group under
        // the same company. The backend now checks that correctly.
        await ipcBridge.oneAdmin.removeUser.invoke({ userId: target.userId });
        Message.success(t('common.enterprise.memberRemoved'));
      } else {
        await ipcBridge.oneEnterprise.removeCompanyMember.invoke({ userId: target.userId });
        Message.success(t('common.enterprise.companyMemberRemoved'));
      }
      onDone(target.userId);
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'LAST_ADMIN_CANNOT_LEAVE') {
        Message.error(t('common.enterprise.removeLastAdmin'));
      } else if (isBackendHttpError(e) && e.code === 'LAST_COMPANY_ADMIN') {
        Message.error(t('common.enterprise.removeLastCompanyAdmin'));
      } else {
        Message.error(t('common.enterprise.removeFailed') + ': ' + String(e));
      }
    } finally {
      setWorking(false);
    }
  }, [target, mode, transferTo, onDone, t]);

  const companyOnly = mode === 'company-only';
  const groupNames = (target?.tenants ?? [])
    .map((tenant) => tenant.name || tenant.tenantId)
    .filter((name): name is string => Boolean(name));

  return (
    <Modal
      visible={target !== null}
      title={companyOnly ? t('common.enterprise.offboardCompanyOnlyTitle') : t('common.enterprise.removeTitle')}
      okText={companyOnly ? t('common.enterprise.offboardCompanyOnlyConfirm') : t('common.enterprise.removeConfirm')}
      okButtonProps={{ status: 'danger' }}
      confirmLoading={working}
      onOk={() => void handleOk()}
      onCancel={onCancel}
    >
      {target && (
        <div className='flex flex-col gap-12px text-13px'>
          {companyOnly ? (
            <>
              <div>{t('common.enterprise.offboardCompanyOnlyBody', { name: target.displayName })}</div>
              <div className='text-t-tertiary text-12px'>{t('common.enterprise.offboardCompanyOnlyEffects')}</div>
              {groupNames.length > 0 && (
                <div className='text-12px' style={{ color: 'var(--color-warning-6)' }}>
                  {t('common.enterprise.offboardStillInGroups', { groups: groupNames.join('、') })}
                </div>
              )}
            </>
          ) : (
            <>
              <div>{t('common.enterprise.removeBody', { name: target.displayName })}</div>
              <div className='text-t-tertiary text-12px'>{t('common.enterprise.removeEffects')}</div>

              {ownedCount === null ? (
                <div className='text-t-tertiary'>{t('common.enterprise.removeCounting')}</div>
              ) : ownedCount > 0 ? (
                <div className='flex flex-col gap-6px'>
                  <div>{t('common.enterprise.removeOwnedResources', { count: ownedCount })}</div>
                  <Select
                    allowClear
                    placeholder={t('common.enterprise.transferPlaceholder')}
                    value={transferTo || undefined}
                    onChange={(v) => setTransferTo(String(v ?? ''))}
                    options={candidates.map((c) => ({ label: c.label, value: c.userId }))}
                  />
                  {!transferTo && (
                    <div className='text-12px' style={{ color: 'var(--color-warning-6)' }}>
                      {t('common.enterprise.transferSkippedWarning')}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default OffboardMemberModal;
