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
  buildSceneConversationRequest,
  resolvePersonalSkillNames,
  resolveSceneSkillNames,
  startSceneConversation,
  type LocalSkill,
} from '@/renderer/utils/scenes/sceneChat';
import { companySceneItem, personalSceneItem } from '@/renderer/utils/scenes/sceneItem';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';
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
  { name: 'mermaid', location: '/builtin/mermaid/SKILL.md', source: 'builtin' },
];

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

describe('resolvePersonalSkillNames', () => {
  it('keeps the skills a personal scene names that still exist, in its order', () => {
    expect(resolvePersonalSkillNames({ skillNames: ['weekly-report', 'gone', 'mermaid'] }, skills)).toEqual([
      'weekly-report',
      'mermaid',
    ]);
  });
});

describe('buildSceneConversationRequest', () => {
  it('a company scene carries its prompt as standing rules and the resolved skills as the starting set', () => {
    const item = companySceneItem(scene({ prompt: '你是发布经理。', skillIds: ['oskill_a1'] }));
    const request = buildSceneConversationRequest({ item, skills, model });
    expect(request.type).toBe('dream');
    expect(request.name).toBe('发布管理');
    expect(request.model).toBe(model);
    expect(request.extra).toMatchObject({
      workspace: '',
      custom_workspace: false,
      preset_rules: '你是发布经理。',
      enabled_skills: ['release-signoff'],
      scene_id: 'scene_1',
    });
    expect(request.extra.selected_mcp_server_ids).toBeUndefined();
  });

  it('a company scene without a prompt falls back to what its own fields say', () => {
    const item = companySceneItem(scene({ prompt: '   ' }));
    const rules = buildSceneConversationRequest({ item, skills, model }).extra.preset_rules;
    expect(rules).toContain('"发布管理"');
    expect(rules).toContain('负责发版排期');
    expect(rules).toContain('发布, 排期');
  });

  it('adds the requirements round only to a scene that asks for it', () => {
    const asks = companySceneItem(
      scene({
        prompt: 'p',
        intent: { discovery: true, starters: [], questions: [], constraints: '', deliverables: '' },
      })
    );
    const quiet = companySceneItem(scene({ prompt: 'p' }));
    expect(buildSceneConversationRequest({ item: asks, skills, model }).extra.preset_rules).toContain(
      'understand first, then build'
    );
    expect(buildSceneConversationRequest({ item: quiet, skills, model }).extra.preset_rules).toBe('p');
  });

  it('a personal scene starts with its own skills and is limited to the MCP servers it names', () => {
    const mine = newPersonalScene({
      name: '官网',
      prompt: '你是 FDE。',
      skillNames: ['weekly-report', 'gone'],
      mcpServerIds: ['mcp_1'],
    });
    const request = buildSceneConversationRequest({ item: personalSceneItem(mine), skills, model });
    expect(request.extra.enabled_skills).toEqual(['weekly-report']);
    expect(request.extra.selected_mcp_server_ids).toEqual(['mcp_1']);
    expect(request.extra.scene_id).toBe(`mine:${mine.id}`);
    expect(request.extra.preset_rules).toContain('你是 FDE。');
    expect(request.extra.preset_rules).toContain('understand first, then build');
  });

  it('a personal scene that names no MCP server leaves the conversation on whatever is enabled', () => {
    const mine = newPersonalScene({ name: '周报' });
    expect(
      buildSceneConversationRequest({ item: personalSceneItem(mine), skills, model }).extra.selected_mcp_server_ids
    ).toBeUndefined();
  });
});

describe('startSceneConversation', () => {
  beforeEach(() => {
    hooks.listAvailableSkills.mockReset().mockResolvedValue(skills);
    hooks.create.mockReset().mockResolvedValue({ id: 'conv_9' });
  });

  it('creates the conversation and returns its id', async () => {
    const item = companySceneItem(scene({ skillIds: ['oskill_b2'] }));
    await expect(startSceneConversation(item, model)).resolves.toBe('conv_9');
    expect(hooks.create.mock.calls[0][0].extra.enabled_skills).toEqual(['weekly-report']);
  });

  it('still opens when the skill list cannot be read, since the rules do not depend on it', async () => {
    hooks.listAvailableSkills.mockRejectedValue(new Error('backend busy'));
    const item = companySceneItem(scene({ skillIds: ['oskill_b2'] }));
    await expect(startSceneConversation(item, model)).resolves.toBe('conv_9');
    expect(hooks.create.mock.calls[0][0].extra.enabled_skills).toEqual([]);
  });

  it('reports a backend that returned no conversation as null, not as an id', async () => {
    hooks.create.mockResolvedValue(null);
    await expect(startSceneConversation(companySceneItem(scene()), model)).resolves.toBeNull();
  });
});
