/**
 * Copyright 2026 One Work
 */

import { Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isToppableVendor, type TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import TrialTopUpModal from './TrialTopUpModal';

/**
 * Small balance tag on a trial provider's row: "¥9.78 left" / "$0.42 left",
 * or a red "used up". For a vendor whose broker-side account API supports a
 * top-up order, the tag is clickable and opens the top-up modal — the one
 * place in settings to add credit.
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
      {toppable && <TrialTopUpModal visible={topUpOpen} vendor={vendor} onClose={() => setTopUpOpen(false)} />}
    </>
  );
};

export default TrialQuotaBadge;
