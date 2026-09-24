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
  remainingAmount,
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

  const balance = quota ? remainingLabel(quota) : null;
  const currentBalance = balance?.text ?? '';
  const amountValid = amount !== null && amount >= MIN_TOPUP_AMOUNT;
  const currency = order?.currency ?? 'CNY';
  // Only previewable against a real number — an uncapped vendor has no
  // "after" to show.
  const balanceNow = quota ? remainingAmount(quota) : null;
  const previewAfter = amountValid && balanceNow !== null ? balanceNow + amount : null;

  return (
    <DreamModal
      variant='standard'
      visible={visible}
      onCancel={onClose}
      header={{ title: t('settings.trialTopUp.title'), showClose: true }}
      footer={null}
      style={{ maxWidth: '92vw', width: 440 }}
    >
      {stage === 'select' && (
        <div className='flex flex-col gap-18px'>
          {/* Balance leads: the number the amount below is going to change. */}
          <div className='rd-12px bg-fill-1 px-16px py-14px'>
            <div className='text-12px text-t-tertiary'>{t('settings.trialTopUp.balanceLabel')}</div>
            <div className='mt-4px flex items-baseline gap-8px'>
              <span
                className={`text-28px font-600 leading-none tracking-tight ${
                  balance?.exhausted ? 'text-[rgba(var(--danger-6),1)]' : 'text-[rgba(var(--primary-6),1)]'
                }`}
              >
                {balance?.exhausted ? t('settings.meteredQuota.exhausted') : currentBalance || '—'}
              </span>
              {previewAfter !== null && (
                <span className='text-13px text-t-secondary'>
                  {t('settings.trialTopUp.afterTopUp', { amount: formatMajorUnits(previewAfter, currency) })}
                </span>
              )}
            </div>
          </div>

          <div>
            <div className='mb-8px text-13px font-medium text-t-primary'>{t('settings.trialTopUp.selectAmount')}</div>
            <div className='grid grid-cols-4 gap-8px'>
              {QUICK_AMOUNTS.map((quick) => {
                const active = amount === quick;
                return (
                  <button
                    key={quick}
                    type='button'
                    onClick={() => setAmount(quick)}
                    className={`h-44px rd-10px border text-15px font-500 cursor-pointer transition-colors ${
                      active
                        ? 'border-[rgba(var(--primary-6),1)] bg-[rgba(var(--primary-6),0.08)] text-[rgba(var(--primary-6),1)]'
                        : 'border-fill-3 bg-transparent text-t-primary hover:border-[rgba(var(--primary-6),0.5)]'
                    }`}
                  >
                    {t('settings.trialTopUp.amountOption', { amount: quick })}
                  </button>
                );
              })}
            </div>

            <InputNumber
              size='large'
              className='!mt-10px !w-full'
              prefix='¥'
              min={MIN_TOPUP_AMOUNT}
              precision={2}
              step={1}
              placeholder={t('settings.trialTopUp.amountPlaceholder', { min: MIN_TOPUP_AMOUNT })}
              value={amount ?? undefined}
              onChange={(value) => setAmount(typeof value === 'number' ? value : null)}
            />
            {amount !== null && amount < MIN_TOPUP_AMOUNT && (
              <p className='mt-6px mb-0 text-12px text-[rgba(var(--danger-6),1)]'>
                {t('settings.trialTopUp.amountTooLow', { min: MIN_TOPUP_AMOUNT })}
              </p>
            )}
          </div>

          <Button
            long
            type='primary'
            size='large'
            loading={creating !== null}
            disabled={!amountValid}
            onClick={() => amount !== null && handleBuy(amount)}
            className='!h-44px !rd-10px'
          >
            {amountValid
              ? t('settings.trialTopUp.confirmTopUpAmount', { amount: formatMajorUnits(amount, currency) })
              : t('settings.trialTopUp.confirmTopUp')}
          </Button>
        </div>
      )}

      {stage === 'paying' && order && (
        <div className='flex flex-col items-center gap-14px py-4px text-center'>
          <div>
            <div className='text-12px text-t-tertiary'>{t('settings.trialTopUp.payAmountLabel')}</div>
            <div className='mt-2px text-30px font-600 leading-none tracking-tight text-t-primary'>
              {formatMajorUnits(order.amount, order.currency)}
            </div>
          </div>

          {order.qr_code && (
            <div className='rd-12px border border-fill-3 bg-white p-12px'>
              <Suspense
                fallback={
                  <div className='flex h-180px w-180px items-center justify-center'>
                    <Spin size={20} />
                  </div>
                }
              >
                <QRCodeSVGLazy value={order.qr_code} size={180} level='M' />
              </Suspense>
            </div>
          )}

          <p className='m-0 text-13px text-t-secondary'>{t('settings.trialTopUp.scanHint')}</p>

          <div className='flex items-center gap-8px rd-20px bg-fill-1 px-12px py-6px text-12px text-t-secondary'>
            <Spin size={12} />
            {t('settings.trialTopUp.waitingPayment')}
          </div>

          <Button size='small' type='text' onClick={reset}>
            {t('settings.trialTopUp.chooseAnother')}
          </Button>
        </div>
      )}

      {stage === 'done' && order && (
        <div className='flex flex-col items-center gap-12px py-12px text-center'>
          <CheckOne theme='filled' size={40} fill={iconColors.success} />
          <div>
            <div className='text-16px font-600 text-t-primary'>
              {t('settings.trialTopUp.creditedAmount', {
                amount: formatMajorUnits(order.amount, order.currency),
              })}
            </div>
            {currentBalance && (
              <div className='mt-4px text-13px text-t-secondary'>
                {t('settings.trialTopUp.newBalance', { amount: currentBalance })}
              </div>
            )}
          </div>
          <Button long type='primary' className='!h-40px !rd-10px' onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      )}
    </DreamModal>
  );
};

export default TrialTopUpModal;
