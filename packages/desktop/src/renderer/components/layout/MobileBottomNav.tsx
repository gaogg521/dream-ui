/**
 * Copyright 2026 One Work
 */

import { BookOne, Config, Home, MessageOne, Timer } from '@icon-park/react';
import classNames from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

/** Bar height (the safe-area inset is added via CSS on top of this). */
export const MOBILE_BOTTOM_NAV_BASE_HEIGHT = 56;

const NAV_ITEMS = [
  { key: 'home', to: '/guid', icon: Home, match: (path: string) => path === '/' || path === '/guid' },
  // A conversation detail is still "in chats" for tab-highlighting purposes.
  {
    key: 'chats',
    to: '/sessions',
    icon: MessageOne,
    match: (path: string) =>
      path.startsWith('/sessions') || path.startsWith('/conversation') || path.startsWith('/team'),
  },
  { key: 'scheduled', to: '/scheduled', icon: Timer, match: (path: string) => path.startsWith('/scheduled') },
  { key: 'knowledge', to: '/knowledge', icon: BookOne, match: (path: string) => path.startsWith('/knowledge') },
  {
    key: 'settings',
    to: '/settings/model',
    icon: Config,
    match: (path: string) =>
      path.startsWith('/settings') || path.startsWith('/assistants') || path.startsWith('/enterprise'),
  },
] as const;

/**
 * Bottom quick nav for the WebUI on phones.
 *
 * On a phone the hamburger drawer is both the navigation chrome and the
 * conversation-history list, so reaching 定时任务/知识库/设置 meant opening the
 * drawer from wherever you were, tapping through, and closing it again. Five
 * fixed tabs put every main destination one tap away; the drawer keeps the
 * history + search role it already has.
 *
 * Mounted only when `isMobile && !isElectronDesktop()` (see Layout.tsx): a
 * desktop window dragged narrow keeps the desktop chrome instead of growing a
 * phone-only bar. Rendered as `position: fixed` with a matching spacer in the
 * content column so page bottoms are never hidden behind the bar.
 */
const MobileBottomNav: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav
      data-testid='mobile-bottom-nav'
      className='fixed inset-x-0 bottom-0 z-80 flex items-stretch border-t border-line bg-2'
      style={{
        height: `calc(${MOBILE_BOTTOM_NAV_BASE_HEIGHT}px + env(safe-area-inset-bottom))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.match(location.pathname);
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type='button'
            data-testid={`mobile-bottom-nav-${item.key}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              Promise.resolve(navigate(item.to)).catch((error) =>
                console.error('[MobileBottomNav] navigate failed:', error)
              );
            }}
            className={classNames(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-3px border-none bg-transparent',
              'cursor-pointer pt-6px pb-4px transition-colors',
              active ? 'text-[rgb(var(--primary-6))]' : 'text-t-tertiary hover:text-t-secondary'
            )}
          >
            <Icon theme='outline' size='20' fill='currentColor' style={{ lineHeight: 0 }} />
            <span className='max-w-full truncate px-2px text-10px leading-14px'>
              {t(`common.bottomNav.${item.key}`)}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default MobileBottomNav;
