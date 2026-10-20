/**
 * Copyright 2026 One Work
 */

/**
 * What a conversation opened from a scene shows before anything has been said.
 *
 * A scene's conversation used to open blank, which tells a person nothing: not
 * which scene they are in, what it brought along, or how it will work. This
 * stands in for a greeting — who this is, what skills and tools came with it,
 * and whether it will ask before it builds — read from what was written onto
 * the conversation when it was opened (`extra.scene_greeting`). It is shown in
 * the empty chat area and goes away with the first message; it is not a message
 * the model produced, so it costs nothing and cannot drift from the facts.
 */

import type { SceneGreeting as SceneGreetingData } from '@/renderer/utils/scenes/sceneChat';
import { Application } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

/** Chips shown before "and N more", so a scene with many skills stays a greeting. */
const MAX_CHIPS = 8;

const Chips: React.FC<{ items: string[]; testId: string }> = ({ items, testId }) => {
  const { t } = useTranslation();
  const shown = items.slice(0, MAX_CHIPS);
  return (
    <div className='flex flex-wrap gap-6px' data-testid={testId}>
      {shown.map((item) => (
        <span key={item} className='rd-6px bg-fill-2 px-8px py-2px text-12px text-t-secondary'>
          {item}
        </span>
      ))}
      {items.length > shown.length ? (
        <span className='px-4px py-2px text-12px text-t-tertiary'>
          {t('common.scenes.greeting.more', { count: items.length - shown.length })}
        </span>
      ) : null}
    </div>
  );
};

/** Rules shown before "and N more": the point is that rules exist, not to restate the scene. */
const MAX_RULES = 4;

/**
 * What the scene changes about this conversation, as plain facts read from the
 * conversation: the role, how it works, the rules in force and what it hands over,
 * then the skills and tools that came along. Shared by the empty-chat greeting and
 * the header badge, so the person can look it up again after the first message.
 */
export const SceneDetails: React.FC<{ greeting: SceneGreetingData }> = ({ greeting }) => {
  const { t } = useTranslation();
  const rules = greeting.rules ?? [];
  return (
    <div className='flex flex-col gap-14px'>
      {greeting.role ? (
        <div className='flex flex-col gap-4px'>
          <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.role')}</div>
          <div className='text-13px leading-[1.6] text-t-primary' data-testid='scene-greeting-role'>
            {greeting.role}
          </div>
        </div>
      ) : null}

      <div className='flex flex-col gap-4px'>
        <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.method')}</div>
        <div className='text-13px leading-[1.6] text-t-secondary' data-testid='scene-greeting-how'>
          {greeting.asksFirst ? t('common.scenes.greeting.asksFirst') : t('common.scenes.greeting.direct')}
        </div>
      </div>

      {rules.length > 0 ? (
        <div className='flex flex-col gap-4px'>
          <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.rules')}</div>
          <ul
            className='m-0 flex list-disc flex-col gap-2px pl-18px text-13px leading-[1.6] text-t-secondary'
            data-testid='scene-greeting-rules'
          >
            {rules.slice(0, MAX_RULES).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
            {rules.length > MAX_RULES ? (
              <li className='list-none text-t-tertiary'>
                {t('common.scenes.greeting.more', { count: rules.length - MAX_RULES })}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {greeting.deliverables ? (
        <div className='flex flex-col gap-4px'>
          <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.deliverables')}</div>
          <div className='text-13px leading-[1.6] text-t-secondary' data-testid='scene-greeting-deliverables'>
            {greeting.deliverables}
          </div>
        </div>
      ) : null}

      <div className='flex flex-col gap-4px'>
        <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.workspace')}</div>
        <div className='break-all text-13px leading-[1.6] text-t-secondary' data-testid='scene-greeting-workspace'>
          {greeting.workspace ? greeting.workspace : t('common.scenes.greeting.workspaceTemp')}
        </div>
      </div>

      {greeting.skills.length > 0 ? (
        <div className='flex flex-col gap-6px'>
          <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.skills')}</div>
          <Chips items={greeting.skills} testId='scene-greeting-skills' />
        </div>
      ) : null}

      {greeting.tools.length > 0 ? (
        <div className='flex flex-col gap-6px'>
          <div className='text-12px text-t-tertiary'>{t('common.scenes.greeting.tools')}</div>
          <Chips items={greeting.tools} testId='scene-greeting-tools' />
        </div>
      ) : null}
    </div>
  );
};

const SceneGreeting: React.FC<{ greeting: SceneGreetingData }> = ({ greeting }) => {
  const { t } = useTranslation();
  return (
    <div className='mx-auto flex max-w-560px flex-col gap-14px px-24px py-32px' data-testid='scene-greeting'>
      <div className='flex items-center gap-12px'>
        <span className='flex h-44px w-44px shrink-0 items-center justify-center rd-12px bg-fill-2 text-24px'>
          {greeting.icon ? greeting.icon : <Application size={22} />}
        </span>
        <div className='min-w-0'>
          <div className='text-16px font-600 text-t-primary'>
            {t('common.scenes.greeting.hello', { name: greeting.name })}
          </div>
          {greeting.description ? <div className='text-13px text-t-tertiary'>{greeting.description}</div> : null}
        </div>
      </div>

      <div className='rd-8px bg-fill-1 px-12px py-8px text-12px leading-[1.6] text-t-secondary'>
        {t('common.scenes.greeting.difference')}
      </div>

      <SceneDetails greeting={greeting} />
    </div>
  );
};

export default SceneGreeting;
