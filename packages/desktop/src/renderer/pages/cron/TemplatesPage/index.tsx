/**
 * Copyright 2026 One Work
 */

/**
 * "Add from template" for automations: a gallery of ready-made ones.
 *
 * A card opens the new-task form already filled in from the template — name,
 * prompt and schedule — and everything stays editable, so a template is a
 * running start, not a fixed thing. Creating it returns to the automations list.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import CreateTaskDialog, { type CreateTaskSeed } from '../ScheduledTasksPage/CreateTaskDialog';
import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplateText,
  type AutomationSchedule,
  type AutomationTemplate,
} from '../templates/automationTemplates';

const CATEGORIES = ['work', 'learning', 'life'] as const;

/** One line saying when a template runs, in the person's language. */
function useWhen() {
  const { t } = useTranslation();
  return useCallback(
    (schedule: AutomationSchedule): string => {
      switch (schedule.frequency) {
        case 'daily':
          return t('cron.templates.when.daily', { time: schedule.time });
        case 'weekdays':
          return t('cron.templates.when.weekdays', { time: schedule.time });
        case 'weekly':
          return t('cron.templates.when.weekly', {
            day: t(`cron.templates.weekday.${schedule.weekday}`),
            time: schedule.time,
          });
        case 'monthly':
          return t('cron.templates.when.monthly', { day: schedule.monthDay, time: schedule.time });
        default:
          return t('cron.templates.when.manual');
      }
    },
    [t]
  );
}

const TemplatesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const when = useWhen();
  const [seed, setSeed] = useState<CreateTaskSeed | null>(null);

  const grouped = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        templates: AUTOMATION_TEMPLATES.filter((template) => template.category === category),
      })).filter((group) => group.templates.length > 0),
    []
  );

  const open = (template: AutomationTemplate) => {
    const text = getAutomationTemplateText(template, i18n.language);
    setSeed({ name: text.name, prompt: text.prompt, schedule: template.schedule });
  };

  return (
    <div className='h-full w-full overflow-auto bg-1' data-testid='automation-templates'>
      <div className='mx-auto box-border w-full max-w-1100px px-16px py-20px md:px-40px md:py-28px'>
        <div className='mb-6px flex items-center gap-8px'>
          <Button
            type='text'
            size='small'
            icon={<Left size={16} />}
            aria-label={t('cron.scheduledTasks')}
            onClick={() => void navigate('/scheduled')}
          />
          <span className='text-14px text-t-secondary'>{t('cron.scheduledTasks')}</span>
          <span className='text-14px text-t-tertiary'>/</span>
          <span className='text-14px font-600 text-t-primary'>{t('cron.templates.title')}</span>
        </div>
        <div className='mb-20px ps-40px text-12px text-t-tertiary'>{t('cron.templates.hint')}</div>

        {grouped.map(({ category, templates }) => (
          <section key={category} className='mb-24px'>
            <div className='mb-10px text-13px font-600 text-t-secondary'>
              {t(`cron.templates.category.${category}`)}
            </div>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-12px md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]'>
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
          </section>
        ))}
      </div>

      <CreateTaskDialog
        visible={seed !== null}
        seed={seed}
        onClose={() => setSeed(null)}
        onCreated={() => void navigate('/scheduled')}
      />
    </div>
  );
};

export default TemplatesPage;
