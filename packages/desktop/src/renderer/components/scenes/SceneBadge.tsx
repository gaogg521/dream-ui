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
import { Button, Popover } from '@arco-design/web-react';
import { Application, Edit } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSceneQuickEdit } from '@/renderer/hooks/enterprise/useSceneQuickEdit';
import { SceneDetails } from './SceneGreeting';

/**
 * `sceneKey` is the key the conversation was opened from (`extra.scene_id`). With it the panel
 * offers "edit scene": the same editor as the home page card. The change applies to conversations
 * opened afterwards; this one keeps the snapshot it started with.
 */
const SceneBadge: React.FC<{ greeting: SceneGreetingData; sceneKey?: string }> = ({ greeting, sceneKey }) => {
  const { t } = useTranslation();
  const quickEdit = useSceneQuickEdit({ insideConversation: true });
  return (
    <>
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
            {sceneKey ? (
              quickEdit.canEdit(sceneKey) ? (
                <Button
                  size='small'
                  icon={<Edit size={13} />}
                  data-testid='scene-badge-edit'
                  onClick={() => quickEdit.open(sceneKey)}
                >
                  {t('common.scenes.editScene')}
                </Button>
              ) : (
                <div className='text-12px text-t-tertiary' data-testid='scene-badge-readonly'>
                  {t('common.scenes.editCompanyReadOnly')}
                </div>
              )
            ) : null}
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
      {quickEdit.element}
    </>
  );
};

export default SceneBadge;
