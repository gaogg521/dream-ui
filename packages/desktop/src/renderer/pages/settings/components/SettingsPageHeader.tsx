/**
 * Copyright 2026 One Work
 */

/**
 * SettingsPageHeader — the shared header paradigm for settings pages.
 *
 * Layout (top to bottom):
 *   1. Title row: page title + description on the left, action slot on the right.
 *   2. Tabs (optional): underline tabs with an optional count badge.
 *
 * Pages own everything below the header (their list/content). This keeps the
 * title sizing, description, action placement, tab styling and responsive
 * breakpoints identical across Agents / Skills / Tools.
 */

import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import classNames from 'classnames';
import React from 'react';

export type SettingsPageTab = {
  key: string;
  label: string;
  /** Optional count badge shown after the label. */
  count?: number;
};

type SettingsPageHeaderProps = {
  title: React.ReactNode;
  /** Secondary description under the title; may contain inline links. */
  description?: React.ReactNode;
  /** Right-aligned action slot (search, create button, dropdowns, …). */
  actions?: React.ReactNode;
  tabs?: SettingsPageTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Disable sticky behavior when the caller renders a fixed header outside its scroll body. */
  sticky?: boolean;
  /** Extra testid for the whole header block. */
  'data-testid'?: string;
};

const SettingsPageHeader: React.FC<SettingsPageHeaderProps> = ({
  title,
  description,
  actions,
  tabs,
  activeTab,
  onTabChange,
  sticky = true,
  'data-testid': dataTestId,
}) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  return (
    <div
      data-testid={dataTestId}
      className={classNames(
        'bg-1',
        // Negative `top` must equal the scroll container's top padding
        // (SettingsPageWrapper: py-14px mobile / md:py-32px). CSS sticky pins to
        // the scrollport's content edge while overflow clips at the padding edge,
        // so a plain `top-0` leaves the top-padding band uncovered and the first
        // scrolled row leaks above the header. Sticking `top` up into that band
        // (paired with the existing pt-* that keeps the title in place) covers it.
        sticky && 'sticky -top-14px z-10 -mt-14px pt-14px md:-top-32px md:-mt-32px md:pt-32px'
      )}
    >
      {/* Mobile stacks the title above its actions instead of sharing one row:
          the actions slot is shrink-0, so on a ~342px content row the flex-1
          title collapsed to zero width and wrapped CJK titles vertically. */}
      <div
        className={classNames(
          'gap-12px sm:gap-16px',
          isMobile ? 'flex flex-col items-stretch' : 'flex items-center justify-between'
        )}
      >
        <h1 className='m-0 min-w-0 flex-1 text-22px md:text-24px font-bold leading-[1.2] text-t-primary'>{title}</h1>
        {actions ? (
          <div
            className={classNames(
              'flex flex-wrap items-center gap-8px',
              isMobile ? 'justify-start' : 'shrink-0 justify-end'
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
      {description ? <p className='m-0 mt-8px text-13px leading-relaxed text-t-secondary'>{description}</p> : null}

      {tabs && tabs.length > 0 ? (
        // Mobile: five tabs with 26px gaps exceed a phone row, so each label
        // wrapped vertically. A touch scroll lane keeps one label per tab and
        // stays inside the page's horizontal padding.
        <div
          className={classNames(
            'mt-18px border-b border-2',
            isMobile
              ? 'flex gap-18px overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              : 'flex gap-26px'
          )}
          role='tablist'
        >
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type='button'
                role='tab'
                aria-selected={isActive}
                data-testid={`settings-tab-${tab.key}`}
                onClick={() => onTabChange?.(tab.key)}
                className={classNames(
                  'relative inline-flex cursor-pointer items-center border-none bg-transparent px-2px pb-12px text-14px leading-none transition-colors',
                  isMobile && 'shrink-0 whitespace-nowrap',
                  isActive ? 'font-600 text-t-primary' : 'font-500 text-t-tertiary hover:text-t-secondary'
                )}
              >
                <span>{tab.label}</span>
                {typeof tab.count === 'number' ? (
                  <span
                    className={classNames(
                      'ms-6px inline-flex h-16px min-w-16px items-center justify-center rounded-999px px-5px text-10px font-500 leading-none',
                      isActive ? 'bg-primary-1 text-primary-6' : 'bg-fill-2 text-t-quaternary'
                    )}
                  >
                    {tab.count}
                  </span>
                ) : null}
                {isActive ? <span className='absolute inset-x-0 -bottom-1px h-2px rounded-2px bg-primary-6' /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default SettingsPageHeader;
