/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import assistantEntryIcon from '@renderer/assets/icons/onework-logo.png';

interface SiderAssistantEntryProps {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
}

const SiderAssistantEntry: React.FC<SiderAssistantEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <Tooltip {...siderTooltipProps} content={t('settings.assistants')} position='right'>
        <div
          className={classNames(
            'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary',
            isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
          )}
          onClick={onClick}
        >
          <img src={assistantEntryIcon} alt='' className='block h-20px w-20px shrink-0 rounded-full object-cover' />
        </div>
      </Tooltip>
    );
  }

  return (
    <Tooltip {...siderTooltipProps} content={t('settings.assistants')} position='right'>
      <div
        className={classNames(
          'box-border group h-34px w-full flex items-center justify-start gap-8px ps-10px pe-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
          isMobile && 'sider-action-btn-mobile',
          isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={onClick}
      >
        <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
          <img src={assistantEntryIcon} alt='' className='block h-16px w-16px rounded-full object-cover' />
        </span>
        <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>
          {t('settings.assistants')}
        </span>
      </div>
    </Tooltip>
  );
};

export default SiderAssistantEntry;
