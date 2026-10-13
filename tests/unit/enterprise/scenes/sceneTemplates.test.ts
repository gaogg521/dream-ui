/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  SCENE_TEMPLATES,
  getSceneTemplate,
  getSceneTemplateText,
  templateIntent,
} from '@/renderer/utils/scenes/sceneTemplates';
import { SCENE_LIMITS } from '@/common/types/platform/sceneTypes';
import { buildSceneRules } from '@/renderer/utils/scenes/sceneProtocol';

describe('scene templates', () => {
  it('have unique ids and a picture', () => {
    const ids = SCENE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of SCENE_TEMPLATES) expect(template.icon).toBeTruthy();
  });

  it('fit the limits a person editing them would be held to, in both languages', () => {
    for (const template of SCENE_TEMPLATES) {
      for (const language of ['zh-CN', 'en-US'] as const) {
        const text = template.text[language];
        expect(text.name.length).toBeLessThanOrEqual(SCENE_LIMITS.name);
        expect(text.description.length).toBeLessThanOrEqual(SCENE_LIMITS.description);
        expect(text.prompt.length).toBeLessThanOrEqual(SCENE_LIMITS.prompt);
        expect(text.starters.length).toBeLessThanOrEqual(SCENE_LIMITS.starters);
        expect(text.questions.length).toBeLessThanOrEqual(SCENE_LIMITS.questions);
        for (const starter of text.starters) expect(starter.length).toBeLessThanOrEqual(SCENE_LIMITS.starter);
        for (const question of text.questions) expect(question.length).toBeLessThanOrEqual(SCENE_LIMITS.question);
        expect(text.constraints.length).toBeLessThanOrEqual(SCENE_LIMITS.constraints);
        expect(text.deliverables.length).toBeLessThanOrEqual(SCENE_LIMITS.deliverables);
      }
    }
  });

  it('say the same things in Chinese and English: same number of questions and starters', () => {
    for (const template of SCENE_TEMPLATES) {
      expect(template.text['zh-CN'].questions).toHaveLength(template.text['en-US'].questions.length);
      expect(template.text['zh-CN'].starters).toHaveLength(template.text['en-US'].starters.length);
    }
  });

  it('every scene that asks first names the questions it needs answered', () => {
    for (const template of SCENE_TEMPLATES.filter((item) => item.discovery)) {
      expect(template.text['en-US'].questions.length).toBeGreaterThan(0);
    }
  });

  it('read Chinese for a Chinese interface and English for everything else', () => {
    const website = getSceneTemplate('website');
    expect(website).toBeDefined();
    if (!website) return;
    expect(getSceneTemplateText(website, 'zh-CN').name).toBe(website.text['zh-CN'].name);
    expect(getSceneTemplateText(website, 'zh-TW').name).toBe(website.text['zh-CN'].name);
    expect(getSceneTemplateText(website, 'en-US').name).toBe(website.text['en-US'].name);
    expect(getSceneTemplateText(website, 'de-DE').name).toBe(website.text['en-US'].name);
  });

  it('the website template is the full worked example: it asks first and will not build before confirmation', () => {
    const website = getSceneTemplate('website');
    expect(website?.discovery).toBe(true);
    const intent = website ? templateIntent(website, 'en-US') : null;
    expect(intent?.questions.length).toBeGreaterThanOrEqual(5);
    expect(intent?.constraints).toContain('write no code until the user has confirmed');
    expect(intent?.constraints).toContain('NOT do');
    const rules = buildSceneRules({ name: 'site', prompt: 'p', intent });
    expect(rules).toContain('Requirements round');
    expect(rules).toContain('Who is the site for?');
  });

  it('a quick, well-defined scene does not ask first, and keeps its rules in the prompt', () => {
    const meeting = getSceneTemplate('meeting');
    expect(meeting?.discovery).toBe(false);
    for (const language of ['zh-CN', 'en-US'] as const) {
      const text = meeting?.text[language];
      // The questions, hard rules and hand-over belong to the ask-first mode, so none are left dangling here.
      expect(text?.questions).toEqual([]);
      expect(text?.constraints).toBe('');
      expect(text?.deliverables).toBe('');
      expect(text?.starters).toEqual([]);
    }
    expect(meeting?.text['en-US'].prompt).toContain('Rules:');
  });
});
