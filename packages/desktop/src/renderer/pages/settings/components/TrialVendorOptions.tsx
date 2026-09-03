/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message } from '@arco-design/web-react';
import { CheckOne, Gift, Loading, Thunderbolt } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isTrialProviderClaimed,
  TRIAL_VENDORS,
  useTrialModelClaim,
  type TrialClaimOutcome,
  type TrialVendor,
} from '@/renderer/hooks/agent/useTrialModelClaim';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { iconColors } from '@/renderer/styles/colors';

const ERROR_KEY_BY_OUTCOME: Partial<Record<TrialClaimOutcome, string>> = {
  already_claimed: 'settings.trialModelErrorAlreadyClaimed',
  rate_limited: 'settings.trialModelErrorRateLimited',
  budget_exhausted: 'settings.trialModelErrorBudgetExhausted',
  unavailable: 'settings.trialModelErrorUnavailable',
  error: 'settings.trialModelErrorGeneric',
};

const VENDOR_ICON: Record<TrialVendor, React.ReactNode> = {
  baoyun: <Gift theme='filled' size={16} fill={iconColors.brand} />,
  openrouter: <Thunderbolt theme='filled' size={16} fill={iconColors.brand} />,
};

/**
 * The list of trial vendors a first-time user can claim from, one row each.
 * Shared by the corner offer (in a modal) and the Add-Platform card.
 *
 * Two entry points, one behaviour: click a vendor -> claim it -> it becomes a
 * normal editable provider (see `useTrialModelClaim`).
 */
const TrialVendorOptions: React.FC<{ onClaimed?: (vendor: TrialVendor) => void }> = ({ onClaimed }) => {
  const { t } = useTranslation();
  const { data: providers } = useProvidersQuery();
  const { claim } = useTrialModelClaim();
  const [pending, setPending] = useState<TrialVendor | null>(null);

  const handleClaim = useCallback(
    async (vendor: TrialVendor) => {
      if (pending) return;
      setPending(vendor);
      try {
        const result = await claim(vendor, t(`settings.trialVendor.${vendor}.providerName`));
        if (result.outcome === 'claimed') {
          Message.success(t('settings.trialModelClaimSuccess'));
          onClaimed?.(vendor);
          return;
        }
        Message.warning(t(ERROR_KEY_BY_OUTCOME[result.outcome] ?? 'settings.trialModelErrorGeneric'));
      } finally {
        setPending(null);
      }
    },
    [claim, onClaimed, pending, t]
  );

  return (
    <div className='flex flex-col gap-8px'>
      {TRIAL_VENDORS.map((vendor) => {
        const claimed = isTrialProviderClaimed(providers, vendor);
        const claiming = pending === vendor;
        return (
          <Button
            key={vendor}
            long
            type='outline'
            disabled={claimed || claiming || pending !== null}
            onClick={() => handleClaim(vendor)}
            className='!h-auto !py-10px !px-12px text-start'
          >
            <div className='flex items-center gap-10px w-full'>
              <span className='flex items-center justify-center w-28px h-28px rounded-6px bg-primary-light-1 shrink-0'>
                {claiming ? (
                  <Loading theme='outline' size={16} className='animate-spin' />
                ) : claimed ? (
                  <CheckOne theme='outline' size={16} fill={iconColors.success} />
                ) : (
                  VENDOR_ICON[vendor]
                )}
              </span>
              <span className='flex flex-col min-w-0 flex-1'>
                <span className='text-13px font-medium text-t-primary truncate'>
                  {t(`settings.trialVendor.${vendor}.title`)}
                </span>
                <span className='text-12px text-t-secondary truncate'>
                  {claiming
                    ? t('settings.trialModelClaiming')
                    : claimed
                      ? t('settings.trialModelClaimSuccess')
                      : t(`settings.trialVendor.${vendor}.desc`)}
                </span>
              </span>
            </div>
          </Button>
        );
      })}
    </div>
  );
};

export default TrialVendorOptions;
