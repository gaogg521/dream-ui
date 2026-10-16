/**
 * Copyright 2026 One Work
 */

import { CloseSmall, Lightning, Right } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DreamModal from '@renderer/components/base/DreamModal';
import TrialVendorOptions from '@renderer/pages/settings/components/TrialVendorOptions';
import { isTrialOfferRedundant, readTrialOfferDismissed, persistTrialOfferDismissed } from './trialOfferVisibility';
import type { IProvider } from '@/common/config/storage';
import styles from './TrialModelBanner.module.css';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import { useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';

/**
 * Corner offer for the built-in free models.
 *
 * Sits bottom-right rather than in the page column: it is a standing promotion
 * for personal workspaces without configured models. Enterprise clients use
 * their administrator's model configuration instead of personal trial offers.
 *
 * Clicking opens a small picker: there is more than one trial vendor now
 * (OpenRouter's free router, and Baoyun's metered ¥10 grant), and firing two
 * corner cards at once would be noise. The card itself still holds still after
 * its entrance — see the CSS module for the motion policy.
 */
const TrialModelBanner: React.FC<{ providers?: IProvider[] }> = ({ providers }) => {
  const { t } = useTranslation();
  const { context, loading } = useOrgContext();
  const [dismissed, setDismissed] = useState(() => readTrialOfferDismissed());
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleDismiss = useCallback(() => {
    persistTrialOfferDismissed();
    setDismissed(true);
  }, []);

  const enterpriseConnected = isEnterpriseRemoteActive() || !!context?.isEnterprise;
  const redundant = useMemo(
    () => isTrialOfferRedundant(providers, enterpriseConnected),
    [providers, enterpriseConnected]
  );
  if (loading || !providers || dismissed || redundant) return null;

  return (
    <>
      <div className={styles.anchor}>
        <div className={styles.card}>
          <button
            type='button'
            onClick={() => setPickerOpen(true)}
            className={styles.action}
            aria-label={t('guid.trialModel.bannerButton')}
          >
            <span className={styles.icon}>
              <Lightning theme='outline' size={16} strokeWidth={4} fill='currentColor' />
            </span>
            <span className={styles.text}>
              <span className={styles.title}>{t('guid.trialModel.bannerTitle')}</span>
              <span className={styles.desc}>{t('guid.trialModel.bannerDesc')}</span>
            </span>
            <Right theme='outline' size={14} strokeWidth={4} fill='currentColor' className={styles.chevron} />
          </button>
          <button type='button' aria-label={t('common.close')} className={styles.close} onClick={handleDismiss}>
            <CloseSmall theme='outline' size={12} strokeWidth={4} fill='currentColor' />
          </button>
        </div>
      </div>

      <DreamModal
        variant='standard'
        visible={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        header={{ title: t('guid.trialModel.pickerTitle'), showClose: true }}
        footer={null}
        style={{ maxWidth: '92vw', width: 420 }}
      >
        <p className='text-13px text-t-secondary mt-0 mb-12px'>{t('guid.trialModel.pickerDesc')}</p>
        <TrialVendorOptions
          onClaimed={() => {
            setPickerOpen(false);
            // No dismiss needed: `isTrialOfferRedundant` hides the offer once a
            // trial provider (or the free model) is present.
          }}
        />
      </DreamModal>
    </>
  );
};

export default TrialModelBanner;
