/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { CheckOne, Loading, Thunderbolt } from '@icon-park/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTrialProviderClaimed,
  useTrialModelClaim,
  type TrialClaimOutcome,
} from '@/renderer/hooks/agent/useTrialModelClaim';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';

const ERROR_KEY_BY_OUTCOME: Partial<Record<TrialClaimOutcome, string>> = {
  already_claimed: 'settings.trialModelErrorAlreadyClaimed',
  rate_limited: 'settings.trialModelErrorRateLimited',
  budget_exhausted: 'settings.trialModelErrorBudgetExhausted',
  unavailable: 'settings.trialModelErrorUnavailable',
  error: 'settings.trialModelErrorGeneric',
};

/**
 * "One-click try free models" card shown at the top of the Add-Platform
 * modal. Bypasses the form entirely — a click claims a capped-spend trial
 * OpenRouter key and materializes it as a normal, editable provider (see
 * `useTrialModelClaim`), then closes the modal on success.
 */
const TrialModelCard: React.FC<{ onClaimed?: () => void }> = ({ onClaimed }) => {
  const { t } = useTranslation();
  const { data: providers } = useProvidersQuery();
  const { claim, claiming } = useTrialModelClaim();
  const alreadyClaimed = isTrialProviderClaimed(providers);

  const handleClick = useCallback(async () => {
    const result = await claim(t('settings.trialModelProviderName'));
    if (result.outcome === 'claimed') {
      Message.success(t('settings.trialModelClaimSuccess'));
      onClaimed?.();
      return;
    }
    const key = ERROR_KEY_BY_OUTCOME[result.outcome] ?? 'settings.trialModelErrorGeneric';
    Message.warning(t(key));
  }, [claim, onClaimed, t]);

  const disabled = claiming || alreadyClaimed;

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={handleClick}
      className='w-full flex items-center gap-10px rounded-8px border border-solid border-fill-3 bg-fill-2 px-14px py-10px mb-12px text-start transition-colors enabled:hover:border-primary enabled:hover:bg-primary-light-1 disabled:cursor-not-allowed disabled:opacity-70'
    >
      <div className='flex items-center justify-center w-28px h-28px rounded-6px bg-primary-light-1 text-primary shrink-0'>
        {claiming ? (
          <Loading theme='outline' size={16} className='animate-spin' />
        ) : alreadyClaimed ? (
          <CheckOne theme='outline' size={16} />
        ) : (
          <Thunderbolt theme='filled' size={16} />
        )}
      </div>
      <div className='min-w-0'>
        <div className='text-13px font-medium text-t-primary truncate'>{t('settings.trialModelCardTitle')}</div>
        <div className='text-12px text-t-secondary truncate'>
          {claiming
            ? t('settings.trialModelClaiming')
            : alreadyClaimed
              ? t('settings.trialModelClaimSuccess')
              : t('settings.trialModelCardDesc')}
        </div>
      </div>
    </button>
  );
};

export default TrialModelCard;
