/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { MeteredOrderResponse } from '@/common/types/provider/providerApi';
import { Button, Message, Spin } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DreamModal from '@renderer/components/base/DreamModal';
import {
  formatMinorUnits,
  remainingLabel,
  useRefreshTrialQuota,
  useTrialQuota,
} from '@renderer/hooks/agent/useTrialQuota';
import { iconColors } from '@/renderer/styles/colors';
import type { TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';

/**
 * Top-up package ids offered by the broker. Kept in sync with
 * `dream-trial-broker`'s `PACKAGES` by hand for now — the pricing rules are
 * not finalized (handoff doc §7), and the order response echoes the real
 * amount/credit/currency so the confirmation is always accurate regardless.
 */
const PACKAGE_IDS = ['59', '99', '199'] as const;

const POLL_INTERVAL_MS = 3000;
/** Give up polling after this long; the order may still settle server-side. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Stage = 'select' | 'paying' | 'done';

const MeteredTopUpModal: React.FC<{
  visible: boolean;
  vendor: TrialVendor;
  onClose: () => void;
  onCredited?: () => void;
}> = ({ visible, vendor, onClose, onCredited }) => {
  const { t } = useTranslation();
  const { data: quota } = useTrialQuota(vendor, visible);
  const refreshQuota = useRefreshTrialQuota();

  const [stage, setStage] = useState<Stage>('select');
  const [order, setOrder] = useState<MeteredOrderResponse | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    clearTimeout(pollTimer.current);
    setStage('select');
    setOrder(null);
    setCreating(null);
  }, []);

  // Start fresh each time the modal opens.
  useEffect(() => {
    if (visible) reset();
    return () => clearTimeout(pollTimer.current);
  }, [visible, reset]);

  const startPolling = useCallback(
    (orderId: string, startedAt: number) => {
      const tick = async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          Message.warning(t('settings.meteredTopUp.pollTimeout'));
          return;
        }
        let latest: MeteredOrderResponse | undefined;
        try {
          latest = await ipcBridge.mode.meteredGetOrder.invoke({ id: orderId });
        } catch {
          // Transient — keep polling.
        }
        if (latest) {
          setOrder(latest);
          if (latest.status === 'paid') {
            setStage('done');
            refreshQuota(vendor);
            onCredited?.();
            return;
          }
          if (latest.status === 'failed' || latest.status === 'expired') {
            Message.error(t('settings.meteredTopUp.orderFailed'));
            reset();
            return;
          }
        }
        pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
      };
      pollTimer.current = setTimeout(tick, POLL_INTERVAL_MS);
    },
    [onCredited, refreshQuota, reset, t, vendor]
  );

  const handleBuy = useCallback(
    async (packageId: string) => {
      if (creating) return;
      setCreating(packageId);
      try {
        const created = await ipcBridge.mode.meteredCreateOrder.invoke({ vendor, package_id: packageId });
        if (!created) {
          Message.error(t('settings.meteredTopUp.orderFailed'));
          return;
        }
        setOrder(created);
        setStage('paying');
        startPolling(created.id, Date.now());
      } catch {
        Message.error(t('settings.meteredTopUp.orderFailed'));
      } finally {
        setCreating(null);
      }
    },
    [creating, startPolling, t, vendor]
  );

  const currentBalance = quota ? remainingLabel(quota).text : '';
  const payUrl = typeof order?.payment?.pay_url === 'string' ? order.payment.pay_url : undefined;

  return (
    <DreamModal
      variant='standard'
      visible={visible}
      onCancel={onClose}
      header={{ title: t('settings.meteredTopUp.title'), showClose: true }}
      footer={null}
      style={{ maxWidth: '92vw', width: 420 }}
    >
      {currentBalance && stage !== 'done' && (
        <p className='text-13px text-t-secondary mt-0 mb-16px'>
          {t('settings.meteredTopUp.currentBalance', { amount: currentBalance })}
        </p>
      )}

      {stage === 'select' && (
        <div className='flex flex-col gap-8px'>
          <span className='text-13px font-medium text-t-primary'>{t('settings.meteredTopUp.selectPackage')}</span>
          {PACKAGE_IDS.map((id) => (
            <Button
              key={id}
              long
              type='outline'
              loading={creating === id}
              disabled={creating !== null && creating !== id}
              onClick={() => handleBuy(id)}
              className='!h-auto !py-10px'
            >
              {t('settings.meteredTopUp.package', { price: id })}
            </Button>
          ))}
        </div>
      )}

      {stage === 'paying' && order && (
        <div className='flex flex-col items-center gap-12px py-8px text-center'>
          <div className='text-14px font-medium text-t-primary'>
            {t('settings.meteredTopUp.payAmount', {
              amount: formatMinorUnits(order.amount_cents, order.currency),
            })}
          </div>
          {payUrl && (
            <div className='text-12px text-t-secondary break-all rounded-6px bg-fill-2 px-10px py-8px w-full'>
              {payUrl}
            </div>
          )}
          <p className='text-12px text-t-secondary m-0'>{t('settings.meteredTopUp.payHint')}</p>
          <div className='flex items-center gap-8px text-t-secondary text-13px'>
            <Spin size={14} />
            {t('settings.meteredTopUp.waitingPayment')}
          </div>
          <Button size='small' type='text' onClick={reset}>
            {t('settings.meteredTopUp.chooseAnother')}
          </Button>
        </div>
      )}

      {stage === 'done' && order && (
        <div className='flex flex-col items-center gap-10px py-12px text-center'>
          <CheckOne theme='filled' size={28} fill={iconColors.success} />
          <div className='text-14px font-medium text-t-primary'>
            {t('settings.meteredTopUp.creditedAmount', {
              amount: formatMinorUnits(order.credit_cents, order.currency),
            })}
          </div>
          {currentBalance && (
            <div className='text-13px text-t-secondary'>
              {t('settings.meteredTopUp.newBalance', { amount: currentBalance })}
            </div>
          )}
          <Button type='primary' onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      )}
    </DreamModal>
  );
};

export default MeteredTopUpModal;
