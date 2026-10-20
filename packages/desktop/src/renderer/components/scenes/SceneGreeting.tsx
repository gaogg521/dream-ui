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
import { Collapse, Tooltip } from '@arco-design/web-react';
import { Application, FolderOpen } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SceneGreeting.module.css';

/** Chips shown before "and N more", so a scene with many skills stays a greeting. */
const MAX_CHIPS = 8;

const Chips: React.FC<{ items: string[]; testId: string }> = ({ items, testId }) => {
  const { t } = useTranslation();
  const shown = items.slice(0, MAX_CHIPS);
  return (
    <div className='flex flex-wrap gap-6px' data-testid={testId}>
      {shown.map((item) => (
        <span key={item} className='rd-6px bg-fill-2 px-8px py-2px text-12px leading-[18px] text-t-secondary'>
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

/** One labelled line of the scene facts: a fixed label column keeps every value aligned. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <div className='pt-1px text-12px leading-[20px] text-t-tertiary'>{label}</div>
    <div className='min-w-0 text-13px leading-[20px] text-t-primary'>{children}</div>
  </>
);

/**
 * What the scene changes about this conversation, as plain facts read from the
 * conversation: the role, how it works, where it works, the skills and tools that
 * came along, and (folded away, they are long) the rules in force and what it hands
 * over. Shared by the empty-chat greeting and the header badge, so the person can
 * look it up again after the first message.
 */
export const SceneDetails: React.FC<{ greeting: SceneGreetingData }> = ({ greeting }) => {
  const { t } = useTranslation();
  const rules = greeting.rules ?? [];
  const folded = [
    rules.length > 0
      ? {
          key: 'rules',
          header: t('common.scenes.greeting.rulesCount', { count: rules.length }),
          testId: 'scene-greeting-rules',
          body: (
            <ul className='m-0 flex list-disc flex-col gap-4px pl-18px'>
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          ),
        }
      : null,
    greeting.deliverables
      ? {
          key: 'deliverables',
          header: t('common.scenes.greeting.deliverables'),
          testId: 'scene-greeting-deliverables',
          body: <div>{greeting.deliverables}</div>,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className='flex flex-col gap-12px'>
      <div className='grid items-baseline gap-x-12px gap-y-10px' style={{ gridTemplateColumns: '56px minmax(0, 1fr)' }}>
        {greeting.role ? (
          <Row label={t('common.scenes.greeting.role')}>
            <span data-testid='scene-greeting-role'>{greeting.role}</span>
          </Row>
        ) : null}
        <Row label={t('common.scenes.greeting.method')}>
          <span className='text-t-secondary' data-testid='scene-greeting-how'>
            {greeting.asksFirst ? t('common.scenes.greeting.asksFirst') : t('common.scenes.greeting.direct')}
          </span>
        </Row>
        <Row label={t('common.scenes.greeting.workspace')}>
          <span className='inline-flex max-w-full items-center gap-6px' data-testid='scene-greeting-workspace'>
            <FolderOpen size={14} className='shrink-0 text-t-tertiary' />
            {greeting.workspace ? (
              <span className='break-all'>{greeting.workspace}</span>
            ) : (
              <Tooltip content={t('common.scenes.greeting.workspaceTemp')}>
                <span className='cursor-help border-0 border-b border-dashed border-[var(--color-border-3)] text-t-secondary'>
                  {t('common.scenes.greeting.workspaceTempShort')}
                </span>
              </Tooltip>
            )}
          </span>
        </Row>
        {greeting.skills.length > 0 ? (
          <Row label={t('common.scenes.greeting.skills')}>
            <Chips items={greeting.skills} testId='scene-greeting-skills' />
          </Row>
        ) : null}
        {greeting.tools.length > 0 ? (
          <Row label={t('common.scenes.greeting.tools')}>
            <Chips items={greeting.tools} testId='scene-greeting-tools' />
          </Row>
        ) : null}
      </div>

      {folded.length > 0 ? (
        <Collapse bordered={false} expandIconPosition='right' className={styles.folded}>
          {folded.map((item) => (
            <Collapse.Item key={item.key} name={item.key} header={item.header} data-testid={`${item.testId}-section`}>
              <div className='text-13px leading-[1.7] text-t-secondary' data-testid={item.testId}>
                {item.body}
              </div>
            </Collapse.Item>
          ))}
        </Collapse>
      ) : null}
    </div>
  );
};

const SceneGreeting: React.FC<{ greeting: SceneGreetingData }> = ({ greeting }) => {
  const { t } = useTranslation();
  return (
    <div className='mx-auto flex max-w-560px flex-col gap-16px px-24px py-32px' data-testid='scene-greeting'>
      <div className='flex items-center gap-14px'>
        <span className='flex h-48px w-48px shrink-0 items-center justify-center rd-14px bg-fill-2 text-26px'>
          {greeting.icon ? greeting.icon : <Application size={24} />}
        </span>
        <div className='min-w-0'>
          <div className='text-17px font-600 leading-[24px] text-t-primary'>
            {t('common.scenes.greeting.hello', { name: greeting.name })}
          </div>
          {greeting.description ? (
            <div className='mt-2px text-13px leading-[20px] text-t-tertiary'>{greeting.description}</div>
          ) : null}
        </div>
      </div>

      <div className='rd-12px border border-solid border-[var(--color-border-2)] bg-fill-1 p-16px'>
        <div className='mb-12px text-12px leading-[18px] text-t-tertiary'>{t('common.scenes.greeting.difference')}</div>
        <SceneDetails greeting={greeting} />
      </div>
    </div>
  );
};

export default SceneGreeting;
