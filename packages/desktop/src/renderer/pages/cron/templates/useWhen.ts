/**
 * Copyright 2026 One Work
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutomationSchedule } from './automationTemplates';

/** One line saying when a template runs, in the person's language. */
export function useWhen() {
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
