/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../index.module.css';

const AUTHOR_QQ = '475332294';

const GuidAuthorTip: React.FC = () => {
  const { t } = useTranslation();

  return (
    <aside className={styles.authorTip} aria-label={t('guid.authorTip.ariaLabel')}>
      <p className={styles.authorTipWelcome}>{t('guid.authorTip.welcome')}</p>
      <p className={styles.authorTipMeta}>
        <span>{t('guid.authorTip.contact')}</span>
        <span className={styles.authorTipAuthor}>allenzhao</span>
        <span className={styles.authorTipSep}>·</span>
        <span>
          {t('guid.authorTip.qqLabel')} {AUTHOR_QQ}
        </span>
      </p>
    </aside>
  );
};

export default GuidAuthorTip;
