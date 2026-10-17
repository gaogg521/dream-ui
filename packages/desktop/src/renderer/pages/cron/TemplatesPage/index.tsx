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
import { Button, Tabs } from '@arco-design/web-react';
import { Left } from '@icon-park/react';
import CreateTaskDialog, { type CreateTaskSeed } from '../ScheduledTasksPage/CreateTaskDialog';
import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplateText,
  type AutomationTemplate,
} from '../templates/automationTemplates';
import { useWhen } from '../templates/useWhen';

const CATEGORIES = ['work', 'learning', 'life'] as const;

const TemplatesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const when = useWhen();
  const [seed, setSeed] = useState<CreateTaskSeed | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

  const visibleTemplates = useMemo(
    () =>
      activeTab === 'all'
        ? AUTOMATION_TEMPLATES
        : AUTOMATION_TEMPLATES.filter((template) => template.category === activeTab),
    [activeTab]
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
        <div className='mb-12px ps-40px text-12px text-t-tertiary'>{t('cron.templates.hint')}</div>

        <Tabs activeTab={activeTab} onChange={setActiveTab} size='small' data-testid='automation-templates-tabs'>
          <Tabs.TabPane title={t('cron.templates.category.all')} key='all' />
          {CATEGORIES.map((category) => (
            <Tabs.TabPane key={category} title={t(`cron.templates.category.${category}`)} />
          ))}
        </Tabs>

        <div className='mt-14px grid grid-cols-[minmax(0,1fr)] gap-12px md:grid-cols-[repeat(2,minmax(0,1fr))] xl:grid-cols-[repeat(3,minmax(0,1fr))]'>
          {visibleTemplates.map((template) => {
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
