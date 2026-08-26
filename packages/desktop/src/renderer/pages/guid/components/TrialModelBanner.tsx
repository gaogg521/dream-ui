/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { CloseSmall, Thunderbolt } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrialModelClaim, type TrialClaimOutcome } from '@/renderer/hooks/agent/useTrialModelClaim';

const ERROR_KEY_BY_OUTCOME: Partial<Record<TrialClaimOutcome, string>> = {
  already_claimed: 'settings.trialModelErrorAlreadyClaimed',
  rate_limited: 'settings.trialModelErrorRateLimited',
  budget_exhausted: 'settings.trialModelErrorBudgetExhausted',
  unavailable: 'settings.trialModelErrorUnavailable',
  error: 'settings.trialModelErrorGeneric',
};

/**
 * Welcome-page empty-state banner: shown only while the `dream` backend has
 * zero configured providers, so a brand-new install has an obvious next
 * step besides opening Settings. Dismissible per-session (not persisted) —
 * a user who dismisses it can still reach the same flow via the
 * Add-Platform modal's `TrialModelCard`.
 */
const TrialModelBanner: React.FC = () => {
  const { t } = useTranslation();
  const { claim, claiming } = useTrialModelClaim();
  const [dismissed, setDismissed] = useState(false);

  const handleClick = useCallback(async () => {
    const result = await claim(t('settings.trialModelProviderName'));
    if (result.outcome === 'claimed') {
      Message.success(t('settings.trialModelClaimSuccess'));
      setDismissed(true);
      return;
    }
    const key = ERROR_KEY_BY_OUTCOME[result.outcome] ?? 'settings.trialModelErrorGeneric';
    Message.warning(t(key));
  }, [claim, t]);

  if (dismissed) return null;

  return (
    <div className='w-full flex items-center gap-12px rounded-10px border border-solid border-fill-3 bg-fill-1 px-16px py-12px mb-16px'>
      <div className='flex items-center justify-center w-32px h-32px rounded-8px bg-primary-light-1 text-primary shrink-0'>
        <Thunderbolt theme='filled' size={18} />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='text-13px font-medium text-t-primary'>{t('guid.trialModel.bannerTitle')}</div>
        <div className='text-12px text-t-secondary'>{t('guid.trialModel.bannerDesc')}</div>
      </div>
      <button
        type='button'
        disabled={claiming}
        onClick={handleClick}
        className='shrink-0 px-14px py-6px rounded-999px text-12px font-medium bg-primary text-white transition-opacity enabled:hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed'
      >
        {claiming ? t('settings.trialModelClaiming') : t('guid.trialModel.bannerButton')}
      </button>
      <button
        type='button'
        aria-label={t('common.close')}
        className='shrink-0 flex items-center justify-center w-20px h-20px text-t-tertiary hover:text-t-secondary'
        onClick={() => setDismissed(true)}
      >
        <CloseSmall theme='outline' size={14} />
      </button>
    </div>
  );
};

export default TrialModelBanner;
