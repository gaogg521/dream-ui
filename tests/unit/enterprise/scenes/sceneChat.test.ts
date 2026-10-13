/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ listAvailableSkills: vi.fn(), create: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: hooks.listAvailableSkills } },
    conversation: { create: { invoke: hooks.create } },
  },
}));

import {
  buildScenePrompt,
  buildSceneConversationRequest,
  resolveSceneSkillNames,
  startSceneConversation,
  type LocalSkill,
} from '@/renderer/components/enterprise/sceneChat';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import type { TProviderWithModel } from '@/common/config/storage';

const scene = (patch: Partial<MyScene> = {}): MyScene => ({
  id: 'scene_1',
  name: '发布管理',
  description: '负责发版排期',
  jobFunctions: ['发布', '排期'],
  builtIn: false,
  resources: [],
  skillIds: [],
  mcpIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...patch,
});

const model = { id: 'prov_1', use_model: 'm' } as unknown as TProviderWithModel;

const skills: LocalSkill[] = [
  { name: 'release-signoff', location: 'C:\\data\\team-skills\\oskill_a1\\SKILL.md', source: 'team' },
  { name: 'weekly-report', location: '/data/team-skills/oskill_b2/SKILL.md', source: 'team' },
  // Same id segment, but not a team skill: must not be taken for the scene's.
  { name: 'imposter', location: '/home/me/skills/oskill_a1/SKILL.md', source: 'custom' },
];

describe('buildScenePrompt', () => {
  it('uses the administrator prompt, trimmed', () => {
    expect(buildScenePrompt(scene({ prompt: '  你是发布经理。  ' }))).toBe('你是发布经理。');
  });

  it('falls back to what the scene own fields say when no prompt was written', () => {
    const text = buildScenePrompt(scene({ prompt: '   ' }));
    expect(text).toContain('"发布管理"');
    expect(text).toContain('负责发版排期');
    expect(text).toContain('发布, 排期');
  });

  it('leaves out description and roles that are empty', () => {
    const text = buildScenePrompt(scene({ description: null, jobFunctions: [] }));
    expect(text).not.toContain('About this scene');
    expect(text).not.toContain('Roles it covers');
  });
});

describe('resolveSceneSkillNames', () => {
  it('maps registry ids to the local team copies, on either path separator', () => {
    expect(resolveSceneSkillNames({ skillIds: ['oskill_a1', 'oskill_b2'] }, skills)).toEqual([
      'release-signoff',
      'weekly-report',
    ]);
  });

  it('skips ids that have not synced and never matches a non-team skill', () => {
    expect(resolveSceneSkillNames({ skillIds: ['oskill_missing', 'oskill_a1'] }, skills)).toEqual(['release-signoff']);
  });

  it('is empty for a scene with no explicit skills, and tolerates a client talking to an older server', () => {
    expect(resolveSceneSkillNames({ skillIds: [] }, skills)).toEqual([]);
    expect(resolveSceneSkillNames({}, skills)).toEqual([]);
  });

  it('does not let an id with path characters reach another directory', () => {
    expect(resolveSceneSkillNames({ skillIds: ['../oskill_a1'] }, skills)).toEqual(['release-signoff']);
    expect(resolveSceneSkillNames({ skillIds: ['///'] }, skills)).toEqual([]);
  });
});

describe('buildSceneConversationRequest', () => {
  it('carries the prompt as standing rules and the resolved skills as the starting set', () => {
    const request = buildSceneConversationRequest({
      scene: scene({ prompt: '你是发布经理。', skillIds: ['oskill_a1'] }),
      skills,
      model,
    });
    expect(request).toEqual({
      type: 'dream',
      name: '发布管理',
      model,
      extra: {
        workspace: '',
        custom_workspace: false,
        preset_rules: '你是发布经理。',
        enabled_skills: ['release-signoff'],
        scene_id: 'scene_1',
      },
    });
  });
});

describe('startSceneConversation', () => {
  beforeEach(() => {
    hooks.listAvailableSkills.mockReset().mockResolvedValue(skills);
    hooks.create.mockReset().mockResolvedValue({ id: 'conv_9' });
  });

  it('creates the conversation and returns its id', async () => {
    await expect(startSceneConversation(scene({ skillIds: ['oskill_b2'] }), model)).resolves.toBe('conv_9');
    expect(hooks.create.mock.calls[0][0].extra.enabled_skills).toEqual(['weekly-report']);
  });

  it('still opens when the skill list cannot be read, since the prompt does not depend on it', async () => {
    hooks.listAvailableSkills.mockRejectedValue(new Error('backend busy'));
    await expect(startSceneConversation(scene({ skillIds: ['oskill_b2'] }), model)).resolves.toBe('conv_9');
    expect(hooks.create.mock.calls[0][0].extra.enabled_skills).toEqual([]);
  });

  it('reports a backend that returned no conversation as null, not as an id', async () => {
    hooks.create.mockResolvedValue(null);
    await expect(startSceneConversation(scene(), model)).resolves.toBeNull();
  });
});
