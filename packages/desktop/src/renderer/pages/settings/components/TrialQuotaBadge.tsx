/**
 * Copyright 2026 One Work
 */

import { Dropdown, Menu, Tag } from '@arco-design/web-react';
import { Down, LinkOut, Search, Wallet } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findTrialProvider, isToppableVendor, type TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import { openExternalUrl } from '@/renderer/utils/platform';
import TrialTopUpModal from './TrialTopUpModal';

/**
 * `dream-trial-broker`'s own usage page — a single static HTML file the
 * broker serves itself (`src/webui.rs`), not part of this app. It calls the
 * broker's public `v1/keys/usage` endpoint same-origin, so it needs no
 * dream-core round-trip and works for anyone with a link.
 */
const KEY_USAGE_QUERY_URL = 'https://work.1oneclaw.com/trial-broker/usage';

/**
 * The page asks for a key because it serves anyone holding one. This app,
 * though, already has this install's — making the user go find it and paste
 * it back is busywork, so it is handed over directly.
 *
 * In the URL *fragment*, never the query string: browsers do not send a
 * fragment to the server, so the key stays out of nginx and broker logs. The
 * page consumes it and immediately clears it from the address bar and that
 * history entry. Without a key on hand the page opens plain and asks, which
 * is also what a shared link does.
 */
function usageQueryUrl(apiKey: string | undefined): string {
  const key = apiKey?.split(/[,\n]/)[0]?.trim();
  return key ? `${KEY_USAGE_QUERY_URL}#key=${encodeURIComponent(key)}` : KEY_USAGE_QUERY_URL;
}

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
  const { data: providers } = useProvidersQuery();
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
          void openExternalUrl(usageQueryUrl(findTrialProvider(providers, vendor)?.api_key));
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
  //
  // `rgba(var(--x), 1)`, not `rgb(var(--x))`: Arco stores its palette as
  // comma-separated channels ("232,243,255"), while UnoCSS compiles the bare
  // `rgb(...)` form to `rgb(var(--x) / var(--un-bg-opacity))` — space-separated
  // syntax, which those commas make invalid, so the browser drops the whole
  // declaration and the element renders unstyled rather than visibly broken.
  const tone = exhausted
    ? 'bg-[rgba(var(--red-1),1)] text-[rgba(var(--red-6),1)] hover:bg-[rgba(var(--red-2),1)]'
    : 'bg-[rgba(var(--arcoblue-1),1)] text-[rgba(var(--arcoblue-6),1)] hover:bg-[rgba(var(--arcoblue-2),1)]';

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
