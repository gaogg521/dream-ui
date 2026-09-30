/**
 * Copyright 2026 One Work
 */

import { Button } from '@arco-design/web-react';
import { Wallet } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProvidersQuery } from '@renderer/hooks/agent/useModelProviderList';
import { isTrialProviderClaimed, TOPUP_CAPABLE_VENDORS } from '@renderer/hooks/agent/useTrialModelClaim';
import { remainingLabel, useTrialQuota } from '@renderer/hooks/agent/useTrialQuota';
import TrialTopUpModal from '@renderer/pages/settings/components/TrialTopUpModal';

/**
 * "Top up" affordance shown under a `USER_LLM_PROVIDER_QUOTA_EXHAUSTED` error
 * — only when the exhausted account is a top-up-capable trial provider that
 * this install holds. Baoyun is Mode A: its API key talks to Baoyun directly,
 * so the broker sees the spent balance only when this component refreshes the
 * key's quota. That fresh read also prevents an unrelated, user-configured
 * provider's quota error from offering to top up the One Work key.
 *
 * The error payload carries no provider id. The quota status is therefore the
 * authoritative second check before presenting a payment action.
 */
const TrialTopUpCta: React.FC = () => {
  const { t } = useTranslation();
  const { data: providers } = useProvidersQuery();
  const [open, setOpen] = useState(false);
  const vendor = TOPUP_CAPABLE_VENDORS.find((candidate) => isTrialProviderClaimed(providers, candidate));
  // Hooks cannot be conditional. `baoyun` is a harmless fallback when no
  // top-up-capable provider is installed; the result is never rendered.
  const { data: quota } = useTrialQuota(vendor ?? 'baoyun');
  const exhausted = quota ? remainingLabel(quota).exhausted : false;

  if (!vendor || !exhausted) return null;

  return (
    <>
      <Button size='small' type='primary' icon={<Wallet theme='outline' size={14} />} onClick={() => setOpen(true)}>
        {t('conversation.meteredTopUp.cta')}
      </Button>
      <TrialTopUpModal visible={open} vendor={vendor} onClose={() => setOpen(false)} />
    </>
  );
};

export default TrialTopUpCta;
