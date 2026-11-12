/**
 * Copyright 2026 One Work
 */

import { Button, Tooltip } from '@arco-design/web-react';
import { Copy, Phone, Refresh } from '@icon-park/react';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, type CardStatusTone } from './SettingsCard';

const QRCodeSVGLazy = React.lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeSVG };
});

export type HeroQr = {
  url: string | null;
  loading: boolean;
  /** Already formatted for display. */
  expiresAt: string | null;
  onRefresh: () => void;
  onCopy: () => void;
};

type RemoteHeroProps = {
  serviceOn: boolean;
  lanOn: boolean;
  internetTone: CardStatusTone;
  internetOn: boolean;
  /** The address a phone should open, when there is one. */
  address?: string;
  /** Whether a scannable code can exist right now (running and reachable). */
  canShowQr: boolean;
  qr: HeroQr;
  onCopyAddress: (text: string) => void;
};

/**
 * The top of the page: one sentence on how a phone can reach this computer right now, the state
 * of each way in, and the QR code that does the actual connecting. The code used to sit at the
 * very bottom, below every switch, although it is the thing a person came here for.
 */
const RemoteHero: React.FC<RemoteHeroProps> = ({
  serviceOn,
  lanOn,
  internetTone,
  internetOn,
  address,
  canShowQr,
  qr,
  onCopyAddress,
}) => {
  const { t } = useTranslation();

  const summary = internetOn
    ? t('settings.webui.heroSummaryInternet')
    : lanOn
      ? t('settings.webui.heroSummaryLan')
      : t('settings.webui.heroSummaryOff');

  return (
    <section
      data-testid='webui-hero-card'
      className='rd-20px px-[18px] md:px-[26px] py-20px box-border border border-solid border-[rgba(var(--primary-6),0.18)] bg-gradient-to-br from-[rgba(var(--primary-6),0.14)] via-[rgba(var(--primary-6),0.06)] to-[var(--color-bg-2)]'
    >
      <div className='flex flex-col md:flex-row md:items-center gap-20px'>
        <div className='min-w-0 flex-1'>
          <div className='inline-flex items-center gap-6px text-12px font-600 tracking-wide text-[rgba(var(--primary-6),1)]'>
            <Phone theme='outline' size='14' />
            {t('settings.webui.heroTitle')}
          </div>
          <h2 className='mt-6px mb-0 text-22px leading-30px font-700 text-t-primary'>{summary}</h2>
          <p className='mt-6px mb-0 text-13px leading-20px text-t-secondary'>{t('settings.webui.description')}</p>

          <div className='mt-14px flex flex-wrap gap-8px'>
            <StatusPill
              tone={serviceOn ? 'success' : 'neutral'}
              text={`${t('settings.webui.cardService')} · ${serviceOn ? t('settings.webui.statusOn') : t('settings.webui.statusOff')}`}
            />
            <StatusPill
              tone={lanOn ? 'success' : 'neutral'}
              text={`${t('settings.webui.cardLan')} · ${lanOn ? t('settings.webui.statusOn') : t('settings.webui.statusOff')}`}
            />
            <StatusPill
              tone={internetTone}
              text={`${t('settings.webui.tunnelTitle')} · ${internetOn ? t('settings.webui.statusOn') : t('settings.webui.statusOff')}`}
            />
          </div>

          {address && (
            <div className='mt-14px inline-flex max-w-full items-center gap-4px rd-10px bg-[var(--color-bg-2)] border border-solid border-[var(--color-border-2)] pl-12px pr-4px py-4px'>
              <span className='text-13px text-t-primary font-mono truncate'>{address}</span>
              <Tooltip content={t('common.copy')}>
                <Button
                  type='text'
                  size='mini'
                  className='rd-100px !px-6px inline-flex items-center !h-24px'
                  onClick={() => onCopyAddress(address)}
                >
                  <Copy size={14} />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>

        <div className='shrink-0 self-center flex flex-col items-center gap-8px' data-testid='webui-qr-panel'>
          {canShowQr ? (
            <>
              <div className='p-10px bg-white rd-16px shadow-[0_6px_20px_rgba(0,0,0,0.10)]'>
                {qr.loading ? (
                  <div className='w-156px h-156px flex items-center justify-center'>
                    <span className='text-13px text-[#86909c]'>{t('common.loading')}</span>
                  </div>
                ) : qr.url ? (
                  <Suspense
                    fallback={
                      <div className='w-156px h-156px flex items-center justify-center'>
                        <span className='text-13px text-[#86909c]'>{t('common.loading')}</span>
                      </div>
                    }
                  >
                    <QRCodeSVGLazy value={qr.url} size={156} level='M' />
                  </Suspense>
                ) : (
                  <div className='w-156px h-156px flex items-center justify-center text-center px-8px'>
                    <span className='text-13px text-[#86909c]'>{t('settings.webui.qrGenerateFailed')}</span>
                  </div>
                )}
              </div>
              <div className='text-13px font-500 text-t-primary'>{t('settings.webui.qrScanCaption')}</div>
              <div className='flex items-center gap-4px text-12px text-t-tertiary'>
                {qr.expiresAt && <span>{t('settings.webui.qrExpires', { time: qr.expiresAt })}</span>}
                {qr.url && (
                  <Tooltip content={t('settings.webui.copyQrLink')}>
                    <button
                      className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer'
                      onClick={qr.onCopy}
                    >
                      <Copy size={14} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content={t('settings.webui.refreshQr')}>
                  <button
                    className='p-4px bg-transparent border-none text-t-tertiary hover:text-t-primary cursor-pointer'
                    onClick={qr.onRefresh}
                    disabled={qr.loading}
                  >
                    <Refresh size={14} className={qr.loading ? 'animate-spin' : ''} />
                  </button>
                </Tooltip>
              </div>
            </>
          ) : (
            <div className='w-[190px] rd-16px border border-dashed border-[var(--color-border-3)] px-14px py-18px text-center text-12px leading-18px text-t-tertiary'>
              {t('settings.webui.heroNoQr')}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default RemoteHero;
