/**
 * Copyright 2026 One Work
 */

import React from 'react';

export type CardStatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export type CardStatus = { tone: CardStatusTone; text: string };

export const TONE_CLASS: Record<CardStatusTone, { pill: string; dot: string; icon: string }> = {
  success: {
    pill: 'bg-[rgba(var(--success-6),0.12)] text-[rgba(var(--success-6),1)]',
    dot: 'bg-[rgba(var(--success-6),1)]',
    icon: 'bg-[rgba(var(--success-6),0.12)] text-[rgba(var(--success-6),1)]',
  },
  warning: {
    pill: 'bg-[rgba(var(--warning-6),0.14)] text-[rgba(var(--warning-6),1)]',
    dot: 'bg-[rgba(var(--warning-6),1)]',
    icon: 'bg-[rgba(var(--warning-6),0.14)] text-[rgba(var(--warning-6),1)]',
  },
  danger: {
    pill: 'bg-[rgba(var(--danger-6),0.12)] text-[rgba(var(--danger-6),1)]',
    dot: 'bg-[rgba(var(--danger-6),1)]',
    icon: 'bg-[rgba(var(--danger-6),0.12)] text-[rgba(var(--danger-6),1)]',
  },
  neutral: {
    pill: 'bg-fill-2 text-t-tertiary',
    dot: 'bg-[var(--color-text-4)]',
    icon: 'bg-fill-2 text-t-tertiary',
  },
};

/** A small coloured pill: dot + text. Also used for the overview's per-channel chips. */
export const StatusPill: React.FC<{ tone: CardStatusTone; text: string }> = ({ tone, text }) => (
  <span
    className={`inline-flex items-center gap-5px px-8px py-1px rd-100px text-12px font-500 ${TONE_CLASS[tone].pill}`}
  >
    <span className={`inline-block w-6px h-6px rd-50% ${TONE_CLASS[tone].dot}`} />
    {text}
  </span>
);

/** A small heading that groups cards ("how to connect", "notifications", ...). */
export const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className='px-4px pt-8px text-12px font-600 tracking-wide text-t-tertiary'>{children}</div>
);

type SettingsCardProps = {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  status?: CardStatus | null;
  /** Right side of the header, usually the card's on/off switch. */
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
};

/**
 * One topic of the remote-connection page. The icon takes the colour of the card's state, so a
 * glance down the page tells what is on (green), pending (amber), failing (red) or off (grey)
 * before any text is read. Cards stand on a lighter surface with a hairline border so they
 * separate from the page instead of blending into it.
 */
const SettingsCard: React.FC<SettingsCardProps> = ({
  icon,
  title,
  description,
  status,
  action,
  children,
  className = '',
  ...rest
}) => (
  <section
    className={`bg-[var(--color-bg-2)] rd-16px px-[16px] md:px-[20px] py-16px box-border border border-solid border-[var(--color-border-2)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    data-testid={rest['data-testid']}
  >
    <div className='flex items-start gap-12px'>
      <span
        className={`shrink-0 inline-flex items-center justify-center w-40px h-40px rd-12px ${TONE_CLASS[status?.tone ?? 'neutral'].icon}`}
      >
        {icon}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-x-8px gap-y-4px'>
          <h3 className='m-0 text-15px font-600 text-t-primary'>{title}</h3>
          {status && <StatusPill tone={status.tone} text={status.text} />}
        </div>
        {description && <div className='mt-4px text-12px leading-18px text-t-secondary'>{description}</div>}
      </div>
      {action && <div className='shrink-0 flex items-center pt-4px'>{action}</div>}
    </div>
    {children && <div className='mt-14px space-y-10px'>{children}</div>}
  </section>
);

export default SettingsCard;
