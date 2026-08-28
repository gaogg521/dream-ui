/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { CloseSmall, Lightning, Right } from '@icon-park/react';
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
    <div className='mt-16px flex w-full animate-fade-in items-center ps-14px'>
      <div className='group inline-flex max-w-full items-center gap-2px'>
        <button
          type='button'
          disabled={claiming}
          onClick={handleClick}
          className='inline-flex min-w-0 cursor-pointer items-center gap-7px rounded-999px border-none bg-transparent px-6px py-4px text-12.5px text-t-secondary transition-colors hover:bg-transparent hover:text-t-primary disabled:cursor-not-allowed disabled:opacity-60'
        >
          {/* IconPark icons in this app are globally configured with a fixed
              `stroke`, so a text-color class does not tint them — the color has
              to go through the `fill` prop. */}
          <Lightning theme='outline' size={13} strokeWidth={4} fill='currentColor' className='shrink-0 text-primary' />
          <span className='truncate'>{t('guid.trialModel.bannerTitle')}</span>
          <span aria-hidden className='text-t-quaternary'>
            ·
          </span>
          <span className='shrink-0 font-medium text-primary'>
            {claiming ? t('settings.trialModelClaiming') : t('guid.trialModel.bannerButton')}
          </span>
          <Right theme='outline' size={12} strokeWidth={4} fill='currentColor' className='shrink-0 text-primary' />
        </button>
        {/* Escape hatch, but this is a first-run hint on an app that cannot do
            anything without a model — so it stays out of the way until hovered
            rather than taking a permanent slot next to the call to action. */}
        <button
          type='button'
          aria-label={t('common.close')}
          className='flex h-18px w-18px shrink-0 cursor-pointer items-center justify-center rounded-999px border-none bg-transparent p-0 text-t-quaternary opacity-0 transition-opacity hover:text-t-secondary group-hover:opacity-100'
          onClick={() => setDismissed(true)}
        >
          <CloseSmall theme='outline' size={12} />
        </button>
      </div>
    </div>
  );
};

export default TrialModelBanner;
