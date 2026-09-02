/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { Wallet } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';
import { isTrialProviderClaimed, METERED_TRIAL_VENDORS } from '@renderer/hooks/agent/useTrialModelClaim';
import MeteredTopUpModal from '@renderer/pages/settings/components/MeteredTopUpModal';

/**
 * "Top up" affordance shown under a `USER_LLM_PROVIDER_QUOTA_EXHAUSTED` error
 * — but only when this install holds a metered trial provider we issued. A
 * user whose own hand-configured key ran out gets the plain error, since
 * there is nothing here for us to top up.
 *
 * The error carries no provider id, so this is a heuristic: if a metered
 * trial account exists and something hit a quota wall, offering a top-up is
 * the right move regardless of which conversation tripped it.
 */
const MeteredTopUpCta: React.FC = () => {
  const { t } = useTranslation();
  const { data: providers } = useProvidersQuery();
  const [open, setOpen] = useState(false);

  const vendor = METERED_TRIAL_VENDORS.find((v) => isTrialProviderClaimed(providers, v));
  if (!vendor) return null;

  return (
    <>
      <Button size='small' type='primary' icon={<Wallet theme='outline' size={14} />} onClick={() => setOpen(true)}>
        {t('conversation.meteredTopUp.cta')}
      </Button>
      <MeteredTopUpModal visible={open} vendor={vendor} onClose={() => setOpen(false)} />
    </>
  );
};

export default MeteredTopUpCta;
