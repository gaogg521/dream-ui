/**
 * Copyright 2026 One Work
 */

/**
 * The mark on a skill or MCP service the company's administrator handed to this
 * member, as opposed to one they installed themselves. The team sync rewrites
 * the local copy of these, so a person should be able to tell at a glance which
 * ones are theirs to change and which belong to the company.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const CompanyBadge: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  return (
    <span
      title={t('common.enterprise.distributedHint')}
      data-testid='company-badge'
      className={`inline-flex shrink-0 items-center rd-4px bg-[rgba(var(--success-6),0.14)] px-5px text-10px leading-16px font-500 text-[rgba(var(--success-6),1)] ${className ?? ''}`}
    >
      {t('common.enterprise.distributedBadge')}
    </span>
  );
};

export default CompanyBadge;
