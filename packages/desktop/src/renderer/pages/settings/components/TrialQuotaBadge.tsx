/**
 * Copyright 2026 One Work
 */

import { Dropdown, Menu, Tag } from '@arco-design/web-react';
import { Down, LinkOut, Search, Wallet } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isToppableVendor, type TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import { openExternalUrl } from '@/renderer/utils/platform';
import TrialTopUpModal from './TrialTopUpModal';

/**
 * `dream-trial-broker`'s own "paste your key, see your usage" page — a
 * single static HTML file the broker serves itself (`src/webui.rs`), not
 * part of this app. It calls the broker's public `v1/keys/usage` endpoint
 * same-origin, so it needs no dream-core round-trip and works for anyone
 * with a link, not just inside this app.
 */
const KEY_USAGE_QUERY_URL = 'https://work.1oneclaw.com/trial-broker/usage';

const MENU_KEY_TOP_UP = 'topUp';
const MENU_KEY_QUERY_USAGE = 'queryUsage';

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * A trial provider's balance on its row: "剩余 ¥9.78" / "$0.42 left", or a
 * red "used up".
 *
 * For a vendor that supports real-money top-up this is a small menu button
 * — top up, or look up usage by key — instead of a bare tag plus a loose
 * icon. The trigger is an Arco `Button` on purpose: Arco's `Trigger` (behind
 * `Dropdown`/`Tooltip`) needs a child that forwards its ref. An IconPark
 * icon doesn't, and under React 19 (no `findDOMNode`) Trigger ends up with a
 * null DOM node and throws inside a layout effect on hover, which unmounts
 * the whole app — see `tests/unit/settings/TrialQuotaBadge.dom.test.tsx`.
 */
const TrialQuotaBadge: React.FC<{ vendor: TrialVendor }> = ({ vendor }) => {
  const { t } = useTranslation();
  const { data: view } = useTrialQuota(vendor);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const toppable = isToppableVendor(vendor);

  if (!view) return null;
  const { text, exhausted } = remainingLabel(view);
  if (!text && !exhausted) return null;

  const label = exhausted
    ? t('settings.meteredQuota.exhausted')
    : t('settings.meteredQuota.remaining', { amount: text });

  if (!toppable) {
    return (
      <Tag size='small' color={exhausted ? 'red' : 'arcoblue'} className='shrink-0'>
        {label}
      </Tag>
    );
  }

  const menu = (
    <Menu
      onClickMenuItem={(key) => {
        if (key === MENU_KEY_TOP_UP) {
          setTopUpOpen(true);
        } else if (key === MENU_KEY_QUERY_USAGE) {
          void openExternalUrl(KEY_USAGE_QUERY_URL);
        }
      }}
    >
      <Menu.Item key={MENU_KEY_TOP_UP}>
        <div className='flex items-center gap-8px' data-testid='trial-quota-menu-top-up'>
          <Wallet theme='outline' size={14} fill='currentColor' />
          <span>{t('settings.trialTopUp.title')}</span>
        </div>
      </Menu.Item>
      <Menu.Item key={MENU_KEY_QUERY_USAGE}>
        <div className='flex items-center gap-8px' data-testid='trial-quota-menu-query-usage'>
          <Search theme='outline' size={14} fill='currentColor' />
          <span className='flex-1'>{t('settings.keyUsageQuery.menuLabel')}</span>
          <LinkOut theme='outline' size={12} fill='currentColor' className='text-t-tertiary' />
        </div>
      </Menu.Item>
    </Menu>
  );

  // Plain elements, not Arco's Button: Button brings its own background and
  // border rules that these have to fight with `!important`, and the pill is
  // simple enough not to need any of them. A span also forwards its ref,
  // which is what Dropdown's Trigger needs (see the doc comment above).
  const tone = exhausted
    ? 'bg-[rgb(var(--red-1))] text-[rgb(var(--red-6))] hover:bg-[rgb(var(--red-2))]'
    : 'bg-[rgb(var(--arcoblue-1))] text-[rgb(var(--arcoblue-6))] hover:bg-[rgb(var(--arcoblue-2))]';

  return (
    // The row header toggles the collapse on click; the menu and the top-up
    // modal both portal to <body>, but React events still bubble through
    // the component tree, so everything is fenced off here.
    <span className='inline-flex shrink-0' onClick={stopPropagation} onMouseDown={stopPropagation}>
      <Dropdown droplist={menu} trigger='click' position='bl' getPopupContainer={() => document.body}>
        <span
          role='button'
          tabIndex={0}
          className={`inline-flex items-center gap-4px h-22px px-8px rounded-11px text-12px font-500 leading-none cursor-pointer select-none transition-colors ${tone}`}
          data-testid='trial-quota-menu-trigger'
        >
          <Wallet theme='outline' size={13} fill='currentColor' />
          <span>{label}</span>
          <Down theme='outline' size={12} fill='currentColor' />
        </span>
      </Dropdown>
      <TrialTopUpModal visible={topUpOpen} vendor={vendor} onClose={() => setTopUpOpen(false)} />
    </span>
  );
};

export default TrialQuotaBadge;
