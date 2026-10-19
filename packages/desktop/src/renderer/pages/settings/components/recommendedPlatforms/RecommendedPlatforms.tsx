/**
 * Copyright 2026 One Work
 */

import { Button, Message } from '@arco-design/web-react';
import { Right } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openExternalUrl } from '@/renderer/utils/platform';
import { RECOMMENDED_PLATFORMS, type RecommendedPlatform } from './constants';
import RecommendedPlatformsGuide from './RecommendedPlatformsGuide';

/**
 * "Recommended platforms" row under the trial card in the Add-Platform modal:
 * four vendors' logos side by side, each one a shortcut to its official site,
 * plus a link to a step-by-step guide (sign up -> pay -> key -> connect).
 */
const RecommendedPlatforms: React.FC = () => {
  const { t } = useTranslation();
  const [guideVisible, setGuideVisible] = useState(false);

  const openSite = useCallback(
    (platform: RecommendedPlatform) => {
      openExternalUrl(platform.url).catch((error: unknown) => {
        console.error('[RecommendedPlatforms] Failed to open external URL:', error);
        Message.error(t('settings.recommendedPlatforms.openFailed'));
      });
    },
    [t]
  );

  return (
    <div className='rounded-8px border border-solid border-fill-3 bg-fill-2 px-14px py-12px mb-12px'>
      <div className='flex items-center justify-between gap-8px mb-10px'>
        <span className='text-13px font-medium text-t-primary'>{t('settings.recommendedPlatforms.title')}</span>
        <Button type='text' size='mini' onClick={() => setGuideVisible(true)} className='!px-4px'>
          <span className='flex items-center gap-2px'>
            {t('settings.recommendedPlatforms.guideLink')}
            <Right theme='outline' size={12} />
          </span>
        </Button>
      </div>
      <div className='grid grid-cols-4 gap-8px'>
        {RECOMMENDED_PLATFORMS.map((platform) => {
          const name = t(`settings.recommendedPlatforms.${platform.id}.name`);
          return (
            <Button
              key={platform.id}
              long
              type='outline'
              aria-label={t('settings.recommendedPlatforms.openSite', { name })}
              onClick={() => openSite(platform)}
              className='!h-auto !py-10px !px-4px'
            >
              <span className='flex flex-col items-center gap-6px min-w-0'>
                <img src={platform.logo} alt='' className='w-28px h-28px rounded-6px object-contain' />
                <span className='text-12px text-t-primary max-w-full truncate'>{name}</span>
              </span>
            </Button>
          );
        })}
      </div>
      <RecommendedPlatformsGuide visible={guideVisible} onClose={() => setGuideVisible(false)} onOpenSite={openSite} />
    </div>
  );
};

export default RecommendedPlatforms;
