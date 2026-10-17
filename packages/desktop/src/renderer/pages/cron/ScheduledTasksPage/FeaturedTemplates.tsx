/**
 * Copyright 2026 One Work
 */

/**
 * The featured-template block on the automations panel: a handful of
 * ready-made automations shown right below the task list, so the panel is
 * never a dead end — with no tasks yet, these are the fastest way to get a
 * first one running. A card opens the create form prefilled; everything
 * stays editable.
 */

import classNames from 'classnames';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import CreateTaskDialog, { type CreateTaskSeed } from './CreateTaskDialog';
import {
  getAutomationTemplateText,
  getFeaturedAutomationTemplates,
  type AutomationTemplate,
} from '../templates/automationTemplates';
import { useWhen } from '../templates/useWhen';

export const FeaturedTemplates: React.FC<{ isMobile: boolean }> = ({ isMobile }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const when = useWhen();
  const [seed, setSeed] = React.useState<CreateTaskSeed | null>(null);

  const templates = React.useMemo(getFeaturedAutomationTemplates, []);

  const open = useCallback(
    (template: AutomationTemplate) => {
      const text = getAutomationTemplateText(template, i18n.language);
      setSeed({ name: text.name, prompt: text.prompt, schedule: template.schedule });
    },
    [i18n.language]
  );

  return (
    <section data-testid='featured-templates'>
      <div className='mb-10px flex items-center justify-between'>
        <span className='text-13px font-600 text-t-secondary'>{t('cron.templates.featuredTitle')}</span>
        <button
          type='button'
          data-testid='featured-templates-view-all'
          onClick={() => void navigate('/scheduled/templates')}
          className='cursor-pointer border-none bg-transparent p-0 text-12px text-t-secondary transition-colors hover:text-t-primary'
        >
          {t('cron.templates.viewAll')}
        </button>
      </div>
      <div
        className={classNames(
          'grid w-full gap-12px',
          isMobile
            ? 'grid-cols-[minmax(0,1fr)]'
            : 'grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]'
        )}
      >
        {templates.map((template) => {
          const text = getAutomationTemplateText(template, i18n.language);
          return (
            <button
              key={template.id}
              type='button'
              data-template={template.id}
              onClick={() => open(template)}
              className='flex cursor-pointer items-start gap-12px rounded-12px border border-solid border-[var(--color-border-2)] bg-1 p-14px text-left transition hover:bg-fill-2'
            >
              <span className='flex h-36px w-36px shrink-0 items-center justify-center rd-10px bg-fill-2 text-20px'>
                {template.icon}
              </span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-14px font-600 text-t-primary'>{text.name}</span>
                <span className='mt-2px line-clamp-2 block text-12px leading-[1.5] text-t-secondary'>
                  {text.description}
                </span>
                <span className='mt-6px block text-11px text-t-tertiary'>{when(template.schedule)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <CreateTaskDialog visible={seed !== null} seed={seed} onClose={() => setSeed(null)} />
    </section>
  );
};

export default FeaturedTemplates;
