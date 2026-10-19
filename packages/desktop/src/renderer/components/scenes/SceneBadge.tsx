/**
 * Copyright 2026 One Work
 */

/**
 * "This conversation is running a scene", in the header, for the whole
 * conversation. The greeting goes away with the first message; this stays, and
 * opens the same facts (role, working method, rules, hand-over, skills, tools),
 * so a person can always tell a scene conversation from a plain one and see what
 * the scene is doing.
 */

import type { SceneGreeting as SceneGreetingData } from '@/renderer/utils/scenes/sceneChat';
import { Popover } from '@arco-design/web-react';
import { Application } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { SceneDetails } from './SceneGreeting';

const SceneBadge: React.FC<{ greeting: SceneGreetingData }> = ({ greeting }) => {
  const { t } = useTranslation();
  return (
    <Popover
      position='bl'
      trigger='click'
      content={
        <div
          className='flex max-h-420px w-340px flex-col gap-10px overflow-y-auto py-4px'
          data-testid='scene-badge-panel'
        >
          <div className='text-14px font-600 text-t-primary'>
            {t('common.scenes.badge.title', { name: greeting.name })}
          </div>
          <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.difference')}</div>
          <SceneDetails greeting={greeting} />
        </div>
      }
    >
      <span
        role='button'
        tabIndex={0}
        className='inline-flex h-24px cursor-pointer select-none items-center gap-4px rd-12px bg-fill-2 px-8px text-12px text-t-secondary hover:bg-fill-3'
        data-testid='scene-badge'
      >
        <Application size={13} />
        {t('common.scenes.badge.label')}
      </span>
    </Popover>
  );
};

export default SceneBadge;
