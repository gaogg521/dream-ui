/**
 * Copyright 2026 One Work
 */

import { Tag, Tooltip } from '@arco-design/web-react';
import { Search } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isToppableVendor, type TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import { iconColors } from '@/renderer/styles/colors';
import KeyUsageQueryModal from './KeyUsageQueryModal';
import TrialTopUpModal from './TrialTopUpModal';

/**
 * Small balance tag on a trial provider's row: "¥9.78 left" / "$0.42 left",
 * or a red "used up". For a vendor whose broker-side account API supports a
 * top-up order, the tag is clickable and opens the top-up modal — the one
 * place in settings to add credit. The same vendors also get a small
 * "look up usage by key" icon next to it — a separate self-service query
 * that works for any key on that vendor, not just this install's own.
 */
const TrialQuotaBadge: React.FC<{ vendor: TrialVendor }> = ({ vendor }) => {
  const { t } = useTranslation();
  const { data: view } = useTrialQuota(vendor);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [usageQueryOpen, setUsageQueryOpen] = useState(false);
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
              setUsageQueryOpen(true);
            }}
          />
        </Tooltip>
      )}
      {toppable && <TrialTopUpModal visible={topUpOpen} vendor={vendor} onClose={() => setTopUpOpen(false)} />}
      {toppable && (
        <KeyUsageQueryModal visible={usageQueryOpen} vendor={vendor} onClose={() => setUsageQueryOpen(false)} />
      )}
    </>
  );
};

export default TrialQuotaBadge;
