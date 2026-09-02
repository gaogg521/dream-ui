/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Thunderbolt } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import TrialVendorOptions from './TrialVendorOptions';
import { iconColors } from '@/renderer/styles/colors';

/**
 * "One-click try free models" section at the top of the Add-Platform modal.
 * Bypasses the form entirely — each row claims a trial from one vendor and
 * materializes it as a normal, editable provider (see `useTrialModelClaim`),
 * then closes the modal on success.
 */
const TrialModelCard: React.FC<{ onClaimed?: () => void }> = ({ onClaimed }) => {
  const { t } = useTranslation();

  return (
    <div className='rounded-8px border border-solid border-fill-3 bg-fill-2 px-14px py-12px mb-12px'>
      <div className='flex items-center gap-8px mb-10px'>
        <Thunderbolt theme='filled' size={16} fill={iconColors.brand} />
        <span className='text-13px font-medium text-t-primary'>{t('settings.trialModelCardTitle')}</span>
      </div>
      <TrialVendorOptions onClaimed={() => onClaimed?.()} />
    </div>
  );
};

export default TrialModelCard;
