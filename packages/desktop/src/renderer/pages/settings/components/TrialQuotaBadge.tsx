/**
 * Copyright 2026 One Work
 */

import { Tag, Tooltip } from '@arco-design/web-react';
import { Search } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isToppableVendor, type TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import { openExternalUrl } from '@/renderer/utils/platform';
import { iconColors } from '@/renderer/styles/colors';
import TrialTopUpModal from './TrialTopUpModal';

/**
 * `dream-trial-broker`'s own "paste your key, see your usage" page — a
 * single static HTML file the broker serves itself (`src/webui.rs`), not
 * part of this app. It calls the broker's public `v1/keys/usage` endpoint
 * same-origin, so it needs no dream-core round-trip and works for anyone
 * with a link, not just inside this app. Originally this was an in-app
 * modal (`KeyUsageQueryModal`, since removed); that traded away easy
 * shareability for no real benefit, so this now just opens the page.
 */
const KEY_USAGE_QUERY_URL = 'https://work.1oneclaw.com/trial-broker/usage';

/**
 * Small balance tag on a trial provider's row: "¥9.78 left" / "$0.42 left",
 * or a red "used up". For a vendor whose broker-side account API supports a
 * top-up order, the tag is clickable and opens the top-up modal — the one
 * place in settings to add credit. The same vendors also get a small
 * "look up usage by key" icon next to it, which opens the broker's own
 * standalone usage-query page in the system browser.
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

  return (
    <>
      <Tag
        size='small'
        color={exhausted ? 'red' : 'arcoblue'}
        className={`shrink-0 ${toppable ? 'cursor-pointer' : ''}`}
        onClick={
          toppable
            ? (e) => {
                e.stopPropagation();
                setTopUpOpen(true);
              }
            : undefined
        }
      >
        {label}
      </Tag>
      {toppable && (
        <Tooltip content={t('settings.keyUsageQuery.entryTooltip')}>
          <Search
            theme='outline'
            size={14}
            fill={iconColors.secondary}
            className='shrink-0 cursor-pointer'
            onClick={(e) => {
              e.stopPropagation();
              void openExternalUrl(KEY_USAGE_QUERY_URL);
            }}
          />
        </Tooltip>
      )}
      {toppable && <TrialTopUpModal visible={topUpOpen} vendor={vendor} onClose={() => setTopUpOpen(false)} />}
    </>
  );
};

export default TrialQuotaBadge;
