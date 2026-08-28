/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { CloseSmall, Lightning, Right } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTrialModelClaim, type TrialClaimOutcome } from '@/renderer/hooks/agent/useTrialModelClaim';
import { isTrialOfferRedundant, readTrialOfferDismissed, persistTrialOfferDismissed } from './trialOfferVisibility';
import type { IProvider } from '@/common/config/storage';
import styles from './TrialModelBanner.module.css';

const ERROR_KEY_BY_OUTCOME: Partial<Record<TrialClaimOutcome, string>> = {
  already_claimed: 'settings.trialModelErrorAlreadyClaimed',
  rate_limited: 'settings.trialModelErrorRateLimited',
  budget_exhausted: 'settings.trialModelErrorBudgetExhausted',
  unavailable: 'settings.trialModelErrorUnavailable',
  error: 'settings.trialModelErrorGeneric',
};

/**
 * Corner offer for the built-in free models.
 *
 * Sits bottom-right rather than in the page column: it is a standing promotion
 * now, not an empty-state hint — a user who already has their own providers
 * sees it too — and the flow from title to composer should not be interrupted
 * for something that is not part of it.
 *
 * On motion: the card animates in, and the bolt has a slow one-off shimmer.
 * There is deliberately no perpetual animation. A pinned element that keeps
 * moving in peripheral vision is the single reason floating promos get hated,
 * and it competes for attention with the thing the user actually came to do.
 * The entrance is enough to be noticed; after that it holds still and the hover
 * state carries the interactivity. `prefers-reduced-motion` skips all of it.
 */
const TrialModelBanner: React.FC<{ providers?: IProvider[] }> = ({ providers }) => {
  const { t } = useTranslation();
  const { claim, claiming } = useTrialModelClaim();
  const [dismissed, setDismissed] = useState(() => readTrialOfferDismissed());

  const handleClick = useCallback(async () => {
    const result = await claim(t('settings.trialModelProviderName'));
    if (result.outcome === 'claimed') {
      Message.success(t('settings.trialModelClaimSuccess'));
      // No dismiss needed: the offer hides itself once the models are there.
      return;
    }
    const key = ERROR_KEY_BY_OUTCOME[result.outcome] ?? 'settings.trialModelErrorGeneric';
    Message.warning(t(key));
    // "Already claimed" on a device with no trial models means the models were
    // removed after claiming, and the broker will refuse forever — the offer
    // can never succeed again, so stop showing it rather than leave a button
    // that is guaranteed to fail.
    if (result.outcome === 'already_claimed') {
      persistTrialOfferDismissed();
      setDismissed(true);
    }
  }, [claim, t]);

  const handleDismiss = useCallback(() => {
    persistTrialOfferDismissed();
    setDismissed(true);
  }, []);

  const redundant = useMemo(() => isTrialOfferRedundant(providers), [providers]);
  if (dismissed || redundant) return null;

  return (
    <div className={styles.anchor}>
      <div className={styles.card}>
        <button
          type='button'
          disabled={claiming}
          onClick={handleClick}
          className={styles.action}
          aria-label={t('guid.trialModel.bannerButton')}
        >
          <span className={styles.icon}>
            <Lightning theme='outline' size={16} strokeWidth={4} fill='currentColor' />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{t('guid.trialModel.bannerTitle')}</span>
            <span className={styles.desc}>
              {claiming ? t('settings.trialModelClaiming') : t('guid.trialModel.bannerDesc')}
            </span>
          </span>
          <Right theme='outline' size={14} strokeWidth={4} fill='currentColor' className={styles.chevron} />
        </button>
        <button type='button' aria-label={t('common.close')} className={styles.close} onClick={handleDismiss}>
          <CloseSmall theme='outline' size={12} strokeWidth={4} fill='currentColor' />
        </button>
      </div>
    </div>
  );
};

export default TrialModelBanner;
