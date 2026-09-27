/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import type { TopupOrderResponse } from '@/common/types/provider/providerApi';
import { Button, InputNumber, Message, Spin } from '@arco-design/web-react';
import { CheckOne, Wallet } from '@icon-park/react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DreamModal from '@renderer/components/base/DreamModal';
import {
  formatMajorUnits,
  grantRemainingAmount,
  paidRemainingAmount,
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
  // The broker already keeps the free-grant pool and the paid pool separate
  // and markup-free on the wire (see crate::visible_balance) — a top-up
  // simply adds the paid amount to `paidRemaining` at face value, no client-
  // side conversion needed. `null` on both only for a vendor with no cap
  // concept (or an old broker predating the split); the modal falls back to
  // a single combined preview in that case.
  const grantRemaining = quota ? grantRemainingAmount(quota) : null;
  const paidRemaining = quota ? paidRemainingAmount(quota) : null;
  const hasSplitBalance = grantRemaining !== null || paidRemaining !== null;
  const previewPaidAfter = amountValid && paidRemaining !== null ? paidRemaining + amount : null;
  const previewCombinedAfter = !hasSplitBalance && amountValid && balanceNow !== null ? balanceNow + amount : null;

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
        <div className='flex flex-col gap-20px pb-2px'>
          {/* Balance leads: the number the amount below is going to change. */}
          <div className='relative overflow-hidden rd-16px border border-[rgba(var(--primary-6),0.13)] bg-[linear-gradient(135deg,rgba(var(--primary-6),0.11),rgba(var(--primary-6),0.025)_58%,transparent)] px-18px py-16px'>
            <div className='absolute -right-10px -top-12px h-70px w-70px rounded-full bg-[rgba(var(--primary-6),0.08)]' />
            <div className='relative flex items-center justify-between'>
              <div className='text-12px font-500 tracking-wide text-t-secondary'>{t('settings.trialTopUp.balanceLabel')}</div>
              <span className='flex h-28px w-28px items-center justify-center rd-9px bg-[rgba(var(--primary-6),0.12)] text-[rgba(var(--primary-6),1)]'>
                <Wallet theme='outline' size={16} fill='currentColor' />
              </span>
            </div>
            <div className='relative mt-7px flex items-baseline gap-8px'>
              <span
                className={`text-28px font-600 leading-none tracking-tight ${
                  balance?.exhausted ? 'text-[rgba(var(--danger-6),1)]' : 'text-[rgba(var(--primary-6),1)]'
                }`}
              >
                {balance?.exhausted ? t('settings.meteredQuota.exhausted') : currentBalance || '—'}
              </span>
              {/* A broker too old to report the grant/paid split has no per-
                  pool preview to show — fall back to one combined number. */}
              {previewCombinedAfter !== null && (
                <span className='text-13px text-t-secondary'>
                  {t('settings.trialTopUp.afterTopUp', { amount: formatMajorUnits(previewCombinedAfter, currency) })}
                </span>
              )}
            </div>
            {hasSplitBalance && (
              <div className='relative mt-12px flex flex-col gap-6px border-t border-[rgba(var(--primary-6),0.13)] pt-11px'>
                {grantRemaining !== null && (
                  <div
                    className='flex items-center justify-between text-12px text-t-secondary'
                    data-testid='grant-balance-row'
                  >
                    <span>{t('settings.trialTopUp.grantBalanceLabel')}</span>
                    <span>{formatMajorUnits(grantRemaining, currency)}</span>
                  </div>
                )}
                {paidRemaining !== null && (
                  <div
                    className='flex items-center justify-between text-12px text-t-secondary'
                    data-testid='paid-balance-row'
                  >
                    <span>{t('settings.trialTopUp.paidBalanceLabel')}</span>
                    <span>
                      {formatMajorUnits(paidRemaining, currency)}
                      {previewPaidAfter !== null && (
                        <span className='text-[rgba(var(--primary-6),1)]'>
                          {' → '}
                          {formatMajorUnits(previewPaidAfter, currency)}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className='mb-10px text-14px font-600 text-t-primary'>{t('settings.trialTopUp.selectAmount')}</div>
            <div className='grid grid-cols-4 gap-10px'>
              {QUICK_AMOUNTS.map((quick) => {
                const active = amount === quick;
                return (
                  <button
                    key={quick}
                    type='button'
                    onClick={() => setAmount(quick)}
                    className={`h-48px rd-12px border text-15px font-600 cursor-pointer transition-all duration-150 ${
                      active
                        ? 'border-[rgba(var(--primary-6),1)] bg-[rgba(var(--primary-6),0.11)] text-[rgba(var(--primary-6),1)] shadow-[0_5px_14px_rgba(var(--primary-6),0.15)]'
                        : 'border-fill-3 bg-fill-1 text-t-primary hover:border-[rgba(var(--primary-6),0.5)] hover:bg-[rgba(var(--primary-6),0.04)]'
                    }`}
                  >
                    {t('settings.trialTopUp.amountOption', { amount: quick })}
                  </button>
                );
              })}
            </div>

            <InputNumber
              size='large'
              className='!mt-12px !w-full'
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
            className='!h-48px !rd-12px !font-600 shadow-[0_8px_18px_rgba(var(--primary-6),0.18)]'
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
