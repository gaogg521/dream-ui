/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import type { TopupOrderResponse } from '@/common/types/provider/providerApi';
import { Button, InputNumber, Message, Spin } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DreamModal from '@renderer/components/base/DreamModal';
import {
  formatMajorUnits,
  remainingLabel,
  useRefreshTrialQuota,
  useTrialQuota,
} from '@renderer/hooks/agent/useTrialQuota';
import { iconColors } from '@/renderer/styles/colors';
import type { TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';

const QRCodeSVGLazy = React.lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeSVG };
});

/**
 * Lowest amount this modal will submit, in the vendor's own currency (CNY
 * for Baoyun, the only vendor this applies to today). The broker itself
 * enforces the same floor (`crate::topup::create_topup_order`) — this is
 * just the client-side half so a bad amount never reaches a network call.
 */
const MIN_TOPUP_AMOUNT = 1;

/** One-tap shortcuts that fill the amount field; the field itself accepts
 * any value at or above `MIN_TOPUP_AMOUNT`, so these are a convenience, not
 * a restriction. */
const QUICK_AMOUNTS = [10, 20, 50, 100] as const;

const POLL_INTERVAL_MS = 3000;
/** Give up polling after this long; the order may still settle server-side. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Stage = 'select' | 'paying' | 'done';

const TrialTopUpModal: React.FC<{
  visible: boolean;
  vendor: TrialVendor;
  onClose: () => void;
  onCredited?: () => void;
}> = ({ visible, vendor, onClose, onCredited }) => {
  const { t } = useTranslation();
  const { data: quota } = useTrialQuota(vendor, visible);
  const refreshQuota = useRefreshTrialQuota();

  const [stage, setStage] = useState<Stage>('select');
  const [order, setOrder] = useState<TopupOrderResponse | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    clearTimeout(pollTimer.current);
    setStage('select');
    setOrder(null);
    setCreating(null);
    setAmount(null);
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
          Message.warning(t('settings.trialTopUp.pollTimeout'));
          return;
        }
        let latest: TopupOrderResponse | undefined;
        try {
          latest = await ipcBridge.mode.topupGetOrder.invoke({ id: orderId, vendor });
        } catch {
          // Transient — keep polling.
        }
        if (latest) {
          setOrder(latest);
          if (latest.status === 'success') {
            setStage('done');
            refreshQuota(vendor);
            onCredited?.();
            return;
          }
          if (latest.status === 'failed' || latest.status === 'expired') {
            Message.error(t('settings.trialTopUp.orderFailed'));
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
    async (submitAmount: number) => {
      if (creating) return;
      setCreating(submitAmount);
      try {
        const created = await ipcBridge.mode.topupCreateOrder.invoke({ vendor, amount: submitAmount });
        if (!created) {
          Message.error(t('settings.trialTopUp.orderFailed'));
          return;
        }
        setOrder(created);
        setStage('paying');
        startPolling(created.id, Date.now());
      } catch {
        Message.error(t('settings.trialTopUp.orderFailed'));
      } finally {
        setCreating(null);
      }
    },
    [creating, startPolling, t, vendor]
  );

  const currentBalance = quota ? remainingLabel(quota).text : '';

  return (
    <DreamModal
      variant='standard'
      visible={visible}
      onCancel={onClose}
      header={{ title: t('settings.trialTopUp.title'), showClose: true }}
      footer={null}
      style={{ maxWidth: '92vw', width: 420 }}
    >
      {currentBalance && stage !== 'done' && (
        <p className='text-13px text-t-secondary mt-0 mb-16px'>
          {t('settings.trialTopUp.currentBalance', { amount: currentBalance })}
        </p>
      )}

      {stage === 'select' && (
        <div className='flex flex-col gap-16px'>
          <div>
            <span className='text-13px font-medium text-t-primary'>{t('settings.trialTopUp.selectAmount')}</span>
            <InputNumber
              size='large'
              className='!mt-8px !w-full'
              prefix='¥'
              min={MIN_TOPUP_AMOUNT}
              precision={2}
              step={1}
              placeholder={t('settings.trialTopUp.amountPlaceholder', { min: MIN_TOPUP_AMOUNT })}
              value={amount ?? undefined}
              onChange={(value) => setAmount(typeof value === 'number' ? value : null)}
            />
            {amount !== null && amount < MIN_TOPUP_AMOUNT && (
              <p className='text-12px text-red-500 mt-4px mb-0'>
                {t('settings.trialTopUp.amountTooLow', { min: MIN_TOPUP_AMOUNT })}
              </p>
            )}
          </div>

          <div className='flex flex-wrap gap-8px'>
            {QUICK_AMOUNTS.map((quick) => (
              <Button
                key={quick}
                size='small'
                shape='round'
                type={amount === quick ? 'primary' : 'secondary'}
                onClick={() => setAmount(quick)}
              >
                {t('settings.trialTopUp.amountOption', { amount: quick })}
              </Button>
            ))}
          </div>

          <Button
            long
            type='primary'
            size='large'
            loading={creating !== null}
            disabled={amount === null || amount < MIN_TOPUP_AMOUNT}
            onClick={() => amount !== null && handleBuy(amount)}
            className='!h-auto !py-10px'
          >
            {t('settings.trialTopUp.confirmTopUp')}
          </Button>
        </div>
      )}

      {stage === 'paying' && order && (
        <div className='flex flex-col items-center gap-12px py-8px text-center'>
          <div className='text-14px font-medium text-t-primary'>
            {t('settings.trialTopUp.payAmount', {
              amount: formatMajorUnits(order.amount, order.currency),
            })}
          </div>
          {order.qr_code && (
            <div className='p-8px bg-white rd-8px'>
              <Suspense
                fallback={
                  <div className='w-160px h-160px flex items-center justify-center'>
                    <Spin size={20} />
                  </div>
                }
              >
                <QRCodeSVGLazy value={order.qr_code} size={160} level='M' />
              </Suspense>
            </div>
          )}
          <p className='text-12px text-t-secondary m-0'>{t('settings.trialTopUp.scanHint')}</p>
          <div className='flex items-center gap-8px text-t-secondary text-13px'>
            <Spin size={14} />
            {t('settings.trialTopUp.waitingPayment')}
          </div>
          <Button size='small' type='text' onClick={reset}>
            {t('settings.trialTopUp.chooseAnother')}
          </Button>
        </div>
      )}

      {stage === 'done' && order && (
        <div className='flex flex-col items-center gap-10px py-12px text-center'>
          <CheckOne theme='filled' size={28} fill={iconColors.success} />
          <div className='text-14px font-medium text-t-primary'>
            {t('settings.trialTopUp.creditedAmount', {
              amount: formatMajorUnits(order.amount, order.currency),
            })}
          </div>
          {currentBalance && (
            <div className='text-13px text-t-secondary'>
              {t('settings.trialTopUp.newBalance', { amount: currentBalance })}
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

export default TrialTopUpModal;
