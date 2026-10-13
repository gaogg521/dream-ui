import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplate,
  getAutomationTemplateText,
} from '@/renderer/pages/cron/templates/automationTemplates';

const HAN = new RegExp('[\\u4e00-\\u9fff]');

describe('automation templates', () => {
  it('have unique ids and every one is complete in both languages', () => {
    const ids = AUTOMATION_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of AUTOMATION_TEMPLATES) {
      for (const language of ['zh-CN', 'en-US'] as const) {
        const text = template.text[language];
        expect(text.name.trim(), `${template.id} ${language} name`).not.toBe('');
        expect(text.description.trim(), `${template.id} ${language} description`).not.toBe('');
        expect(text.prompt.trim().length, `${template.id} ${language} prompt`).toBeGreaterThan(20);
      }
      // The English copy is for people who read English: no stray Chinese.
      expect(template.text['en-US'].name + template.text['en-US'].prompt).not.toMatch(HAN);
    }
  });

  it('cover every category and use schedules the form can express', () => {
    expect(new Set(AUTOMATION_TEMPLATES.map((template) => template.category))).toEqual(
      new Set(['work', 'learning', 'life'])
    );
    for (const template of AUTOMATION_TEMPLATES) {
      const schedule = template.schedule;
      if (schedule.frequency === 'manual') continue;
      expect(schedule.time, template.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      if (schedule.frequency === 'monthly') {
        // Past the 28th some months have no such day, so the run would silently skip them.
        expect(schedule.monthDay, template.id).toBeGreaterThanOrEqual(1);
        expect(schedule.monthDay, template.id).toBeLessThanOrEqual(28);
      }
    }
  });

  it('look a template up by id and read its text in the right language', () => {
    const template = getAutomationTemplate('daily-ai-brief');
    expect(template).toBeDefined();
    expect(getAutomationTemplate('nope')).toBeUndefined();
    expect(getAutomationTemplateText(template!, 'zh-CN').name).toBe('每日行业资讯简报');
    expect(getAutomationTemplateText(template!, 'zh-TW').name).toBe('每日行业资讯简报');
    expect(getAutomationTemplateText(template!, 'ja-JP').name).toBe('Daily industry news brief');
  });
});
