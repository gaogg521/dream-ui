/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildDiscoveryRules,
  buildRoleRules,
  buildSceneFrame,
  buildSceneRules,
} from '@/renderer/utils/scenes/sceneProtocol';
import type { SceneIntent } from '@/common/types/platform/sceneTypes';

const intent = (patch: Partial<SceneIntent> = {}): SceneIntent => ({
  discovery: true,
  starters: [],
  questions: [],
  constraints: '',
  deliverables: '',
  ...patch,
});

describe('buildRoleRules', () => {
  it('uses the written prompt, trimmed', () => {
    expect(buildRoleRules({ name: 'x', prompt: '  你是发布经理。  ' })).toBe('你是发布经理。');
  });

  it('falls back to what the scene own fields say', () => {
    const text = buildRoleRules({
      name: '发布管理',
      description: '负责发版排期',
      prompt: '   ',
      jobFunctions: ['发布', ' ', '排期'],
    });
    expect(text).toContain('"发布管理"');
    expect(text).toContain('负责发版排期');
    expect(text).toContain('发布, 排期');
  });

  it('leaves out a description and roles that are empty', () => {
    const text = buildRoleRules({ name: 'x', description: null, jobFunctions: [] });
    expect(text).not.toContain('About this scene');
    expect(text).not.toContain('Roles it covers');
  });
});

describe('buildDiscoveryRules', () => {
  it('tells the assistant not to build from the first message, and to confirm before it does', () => {
    const text = buildDiscoveryRules([]);
    expect(text).toContain('entry point, not a specification');
    expect(text).toContain('Requirements round, before any build work');
    expect(text).toContain('what is IN the first version, what is OUT');
    expect(text).toContain('Only after the user confirms');
  });

  it('keeps the round a conversation: no browsing the file system to look around', () => {
    const text = buildDiscoveryRules([]);
    expect(text).toContain('not an investigation');
    expect(text).toContain('Until the user has confirmed the brief, call no tools except the ask-the-user tool');
    expect(text).toContain('query connected systems to look around');
  });

  it('lets the assistant skip the round when the request is already specific, or the user says so', () => {
    expect(buildDiscoveryRules([])).toContain('Skip steps 1-3 only when the user asks you to');
    expect(buildDiscoveryRules([])).toContain('already specific enough');
  });

  it('lists the questions the scene always needs answered, and drops blank ones', () => {
    const text = buildDiscoveryRules(['Who maintains it?', '   ', 'Who is it for?']);
    expect(text).toContain('This scene always needs these answered:');
    expect(text).toContain('- Who maintains it?');
    expect(text).toContain('- Who is it for?');
    expect(text).not.toMatch(/- \s*\n/);
  });

  it('has no questions section when the scene lists none', () => {
    expect(buildDiscoveryRules([])).not.toContain('always needs these answered');
  });
});

describe('buildSceneFrame', () => {
  it('says this conversation belongs to a scene and what to answer when asked who the assistant is', () => {
    const text = buildSceneFrame({ name: '数据分析与报告', description: '先问清决策再分析' });
    expect(text).toContain('Scene: "数据分析与报告"');
    expect(text).toContain('Purpose: 先问清决策再分析');
    expect(text).toContain('If you are asked who you are or what you can do, answer as this scene');
    expect(text).toContain('Do not introduce yourself as a generic assistant');
  });

  it('lists the example openers, from the input or else from the intent', () => {
    expect(buildSceneFrame({ name: 'x', starters: ['A', ' ', 'B'] })).toContain('"A"; "B"');
    expect(buildSceneFrame({ name: 'x', intent: intent({ starters: ['C'] }) })).toContain('"C"');
    expect(buildSceneFrame({ name: 'x' })).not.toContain('Examples of how people start');
  });

  it('leaves out the purpose line when the scene has no description', () => {
    expect(buildSceneFrame({ name: 'x', description: '  ' })).not.toContain('Purpose:');
  });
});

describe('buildSceneRules', () => {
  it('is the scene identity followed by the role when the scene has no intent', () => {
    for (const input of [
      { name: 'x', prompt: 'p' },
      { name: 'x', prompt: 'p', intent: null },
    ]) {
      const text = buildSceneRules(input);
      expect(text.startsWith('## You are working inside a scene')).toBe(true);
      expect(text.endsWith('## Your role in this scene\np')).toBe(true);
      expect(text).not.toContain('understand first, then build');
    }
  });

  it('adds the working method only when discovery is on', () => {
    expect(buildSceneRules({ name: 'x', prompt: 'p', intent: intent({ discovery: false }) })).not.toContain(
      'understand first, then build'
    );
    expect(buildSceneRules({ name: 'x', prompt: 'p', intent: intent() })).toContain('understand first, then build');
  });

  it('adds hard rules and deliverables, in that order after the method', () => {
    const text = buildSceneRules({
      name: 'x',
      prompt: 'p',
      intent: intent({ constraints: 'No code before the plan is confirmed.', deliverables: 'A prototype.' }),
    });
    const method = text.indexOf('understand first');
    const rules = text.indexOf('## Hard rules for this scene');
    const handover = text.indexOf('## What to hand over');
    expect(method).toBeGreaterThan(0);
    expect(rules).toBeGreaterThan(method);
    expect(handover).toBeGreaterThan(rules);
    expect(text).toContain('No code before the plan is confirmed.');
    expect(text).toContain('A prototype.');
  });

  it('applies the questions, hard rules and hand-over only to a scene that asks first', () => {
    const text = buildSceneRules({
      name: 'x',
      prompt: 'p',
      intent: intent({ discovery: false, questions: ['Q?'], constraints: 'Never X.', deliverables: 'A prototype.' }),
    });
    expect(text).toContain('## Your role in this scene\np');
    expect(text).not.toContain('Never X.');
    expect(text).not.toContain('A prototype.');
    expect(text).not.toContain('Q?');
  });
});
