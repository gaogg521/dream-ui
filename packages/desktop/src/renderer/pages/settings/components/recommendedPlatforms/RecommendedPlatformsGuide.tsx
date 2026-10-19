/**
 * Copyright 2026 One Work
 */

import { Button, Tag } from '@arco-design/web-react';
import { Link, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import DreamModal from '@renderer/components/base/DreamModal';
import { RECOMMENDED_PLATFORMS, type RecommendedPlatform } from './constants';

type GuideProps = {
  visible: boolean;
  onClose: () => void;
  onOpenSite: (platform: RecommendedPlatform) => void;
};

/**
 * Reference sheet for the four recommended vendors: how to sign up, pay, get a
 * key and plug it into a tool. Prices are a dated snapshot — the disclaimer at
 * the top says the vendor's own site is authoritative.
 */
const RecommendedPlatformsGuide: React.FC<GuideProps> = ({ visible, onClose, onOpenSite }) => {
  const { t } = useTranslation();
  const base = 'settings.recommendedPlatforms';

  return (
    <DreamModal
      variant='standard'
      visible={visible}
      onCancel={onClose}
      header={{ title: t(`${base}.guideTitle`), showClose: true }}
      footer={null}
      style={{ maxWidth: '92vw', width: 760 }}
    >
      <div className='flex flex-col gap-12px max-h-[68vh] overflow-y-auto pr-4px'>
        <p className='m-0 text-12px text-t-secondary'>{t(`${base}.guideSubtitle`)}</p>
        {RECOMMENDED_PLATFORMS.map((platform) => (
          <div key={platform.id} className='rounded-8px border border-solid border-fill-3 bg-fill-1 px-14px py-12px'>
            <div className='flex items-center gap-10px mb-10px'>
              <img src={platform.logo} alt='' className='w-28px h-28px rounded-6px object-contain shrink-0' />
              <span className='text-14px font-medium text-t-primary'>{t(`${base}.${platform.id}.name`)}</span>
              <Tag size='small' color='arcoblue' className='min-w-0 truncate'>
                {t(`${base}.${platform.id}.tag`)}
              </Tag>
              <span className='flex-1' />
              <Button type='text' size='mini' onClick={() => onOpenSite(platform)}>
                <span className='flex items-center gap-4px'>
                  <Link theme='outline' size={12} />
                  {t(`${base}.guideOpenSite`)}
                </span>
              </Button>
            </div>
            <div className='grid grid-cols-4 gap-8px'>
              {platform.steps.map((step, index) => (
                <div key={step.label} className='relative rounded-6px bg-fill-2 px-10px py-8px min-w-0'>
                  <div className='text-12px font-medium text-t-primary'>
                    {index + 1}. {t(`${base}.step.${step.label}`)}
                  </div>
                  {step.literal && <div className='text-12px text-t-secondary break-words'>{step.literal}</div>}
                  {step.detailKey && (
                    <div className='text-12px text-t-secondary break-words'>
                      {t(`${base}.${platform.id}.${step.detailKey}`)}
                    </div>
                  )}
                  {index < platform.steps.length - 1 && (
                    <Right
                      theme='outline'
                      size={12}
                      className='absolute -right-9px top-1/2 -translate-y-1/2 text-t-tertiary z-1'
                    />
                  )}
                </div>
              ))}
            </div>
            {platform.baseUrl && (
              <div className='mt-8px text-12px text-t-secondary break-all'>
                {t(`${base}.baseUrlLabel`)}: <code>{platform.baseUrl}</code>
              </div>
            )}
            <div className='mt-8px text-12px text-t-secondary'>{t(`${base}.${platform.id}.price`)}</div>
          </div>
        ))}
      </div>
    </DreamModal>
  );
};

export default RecommendedPlatformsGuide;
