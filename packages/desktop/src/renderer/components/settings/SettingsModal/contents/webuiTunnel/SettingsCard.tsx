/**
 * Copyright 2026 One Work
 */

import React from 'react';

export type CardStatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export type CardStatus = { tone: CardStatusTone; text: string };

const TONE_CLASS: Record<CardStatusTone, { pill: string; dot: string }> = {
  success: {
    pill: 'bg-[rgba(var(--success-6),0.12)] text-[rgba(var(--success-6),1)]',
    dot: 'bg-[rgba(var(--success-6),1)]',
  },
  warning: {
    pill: 'bg-[rgba(var(--warning-6),0.12)] text-[rgba(var(--warning-6),1)]',
    dot: 'bg-[rgba(var(--warning-6),1)]',
  },
  danger: {
    pill: 'bg-[rgba(var(--danger-6),0.12)] text-[rgba(var(--danger-6),1)]',
    dot: 'bg-[rgba(var(--danger-6),1)]',
  },
  neutral: { pill: 'bg-fill-2 text-t-tertiary', dot: 'bg-[var(--color-text-4)]' },
};

type SettingsCardProps = {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  status?: CardStatus | null;
  /** Right side of the header, usually the card's on/off switch. */
  action?: React.ReactNode;
  children?: React.ReactNode;
  'data-testid'?: string;
};

/**
 * One topic of the remote-connection page: an icon, a title with its state at a glance,
 * the card's own switch, and the details underneath. Cards stand alone so a person can see
 * what each switch controls without reading across the whole page.
 */
const SettingsCard: React.FC<SettingsCardProps> = ({ icon, title, description, status, action, children, ...rest }) => (
  <section className='bg-2 rd-16px px-[14px] md:px-[20px] py-14px box-border' data-testid={rest['data-testid']}>
    <div className='flex items-start gap-12px'>
      <span className='shrink-0 inline-flex items-center justify-center w-36px h-36px rd-10px bg-[rgba(var(--primary-6),0.1)] text-[rgba(var(--primary-6),1)]'>
        {icon}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-x-8px gap-y-4px'>
          <h3 className='m-0 text-15px font-600 text-t-primary'>{title}</h3>
          {status && (
            <span
              className={`inline-flex items-center gap-5px px-8px py-1px rd-100px text-12px font-500 ${TONE_CLASS[status.tone].pill}`}
            >
              <span className={`inline-block w-6px h-6px rd-50% ${TONE_CLASS[status.tone].dot}`} />
              {status.text}
            </span>
          )}
        </div>
        {description && <div className='mt-2px text-12px leading-18px text-t-secondary'>{description}</div>}
      </div>
      {action && <div className='shrink-0 flex items-center pt-2px'>{action}</div>}
    </div>
    {children && <div className='mt-12px pt-12px border-t border-solid border-[var(--color-border-2)]'>{children}</div>}
  </section>
);

export default SettingsCard;
