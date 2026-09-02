/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tag } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMeteredTrialVendor, type TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import MeteredTopUpModal from './MeteredTopUpModal';

/**
 * Small balance tag on a trial provider's row: "¥9.78 left" / "$0.42 left",
 * or a red "used up". For a metered vendor the tag is clickable and opens the
 * top-up modal — the one place in settings to add credit.
 */
const TrialQuotaBadge: React.FC<{ vendor: TrialVendor }> = ({ vendor }) => {
  const { t } = useTranslation();
  const { data: view } = useTrialQuota(vendor);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const metered = isMeteredTrialVendor(vendor);

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
        className={`shrink-0 ${metered ? 'cursor-pointer' : ''}`}
        onClick={
          metered
            ? (e) => {
                e.stopPropagation();
                setTopUpOpen(true);
              }
            : undefined
        }
      >
        {label}
      </Tag>
      {metered && <MeteredTopUpModal visible={topUpOpen} vendor={vendor} onClose={() => setTopUpOpen(false)} />}
    </>
  );
};

export default TrialQuotaBadge;
