/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ listAvailableSkills: vi.fn(), create: vi.fn(), activate: vi.fn(), sync: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: hooks.listAvailableSkills } },
    oneDevops: { activateSceneMcp: { invoke: hooks.activate } },
    conversation: { create: { invoke: hooks.create } },
  },
}));

vi.mock('@/renderer/utils/enterprise/teamSkillSync', () => ({ syncTeamMcp: hooks.sync }));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: vi.fn(async () => ({
    allServers: [
      { id: 'row_1', name: 'Business', original_json: '{"teamRegistryId":"omcp_1"}' },
      { id: 'row_2', name: 'Mine', original_json: '{"mcpServers":{}}' },
    ],
  })),
}));

import {
  buildSceneConversationRequest,
  resolveSceneMcpServerIds,
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

describe('resolveSceneMcpServerIds', () => {
  const servers = [
    { id: 'row_1', original_json: '{"teamRegistryId":"omcp_1"}' },
    { id: 'row_2', original_json: '{"mcpServers":{}}' },
    { id: 'row_3', original_json: 'not json' },
    { id: 'row_4' },
    { id: 'row_5', original_json: '{"teamRegistryId":"omcp_2"}' },
  ];

  it('maps registry ids to the local rows the team sync tagged with them', () => {
    expect(resolveSceneMcpServerIds({ mcpIds: ['omcp_1', 'omcp_2'] }, servers)).toEqual(['row_1', 'row_5']);
  });

  it('skips connectors that have not synced, and rows that are not team rows', () => {
    expect(resolveSceneMcpServerIds({ mcpIds: ['omcp_missing'] }, servers)).toEqual([]);
    expect(resolveSceneMcpServerIds({ mcpIds: [] }, servers)).toEqual([]);
    expect(resolveSceneMcpServerIds({}, servers)).toEqual([]);
  });
});

describe('buildSceneConversationRequest', () => {
  it('a company scene that grants connectors limits the conversation to the ones that have synced', () => {
    const item = companySceneItem(scene({ mcpIds: ['omcp_1'] }));
    const request = buildSceneConversationRequest({
      item,
      skills,
      model,
      mcpServers: [{ id: 'row_1', original_json: '{"teamRegistryId":"omcp_1"}' }],
    });
    expect(request.extra.selected_mcp_server_ids).toEqual(['row_1']);
  });

  it('uses an explicit empty snapshot when scene connectors are missing', () => {
    const item = companySceneItem(scene({ mcpIds: ['omcp_1'] }));
    expect(
      buildSceneConversationRequest({ item, skills, model, mcpServers: [] }).extra.selected_mcp_server_ids
    ).toEqual([]);
  });

  it('writes a greeting onto the conversation: which scene, what came with it, and how it will work', () => {
    const company = companySceneItem(
      scene({
        description: '负责发版排期',
        skillIds: ['oskill_a1'],
        mcpIds: ['omcp_1'],
        intent: { discovery: true, starters: [], questions: [], constraints: '', deliverables: '' },
      })
    );
    const greeting = buildSceneConversationRequest({
      item: company,
      skills,
      model,
      mcpServers: [{ id: 'row_1', name: 'Business MCP', original_json: '{"teamRegistryId":"omcp_1"}' }],
    }).extra.scene_greeting;
    expect(greeting).toMatchObject({
      name: '发布管理',
      description: '负责发版排期',
      skills: ['release-signoff'],
      tools: ['Business MCP'],
      asksFirst: true,
    });
    // A scene that asks first also shows the role, and has no rules or hand-over to claim yet.
    expect(greeting?.role).toBeTruthy();
    expect(greeting?.rules).toBeUndefined();
    expect(greeting?.deliverables).toBeUndefined();
  });

  it('a personal scene greets with its emoji, its skills and the servers it is limited to, by name', () => {
    const mine = newPersonalScene({
      name: '官网',
      icon: '🌐',
      skillNames: ['weekly-report'],
      mcpServerIds: ['mcp_1', 'mcp_gone'],
      intent: { discovery: false, starters: [], questions: [], constraints: '', deliverables: '' },
    });
    const greeting = buildSceneConversationRequest({
      item: personalSceneItem(mine),
      skills,
      model,
      mcpServers: [{ id: 'mcp_1', name: 'Docs server' }],
    }).extra.scene_greeting;
    expect(greeting).toMatchObject({ icon: '🌐', skills: ['weekly-report'], tools: ['Docs server'], asksFirst: false });
  });

  it('does not claim a tool limit that was not applied', () => {
    const item = companySceneItem(scene({ mcpIds: ['omcp_1'] }));
    expect(buildSceneConversationRequest({ item, skills, model, mcpServers: [] }).extra.scene_greeting?.tools).toEqual(
      []
    );
  });

  it('carries the example openers, for scenes that ask first, so the conversation can offer them', () => {
    const asks = companySceneItem(
      scene({
        intent: { discovery: true, starters: ['Make me a website'], questions: [], constraints: '', deliverables: '' },
      })
    );
    expect(buildSceneConversationRequest({ item: asks, skills, model }).extra.scene_starters).toEqual([
      'Make me a website',
    ]);
    const quiet = companySceneItem(
      scene({
        intent: { discovery: false, starters: ['Make me a website'], questions: [], constraints: '', deliverables: '' },
      })
    );
    expect(buildSceneConversationRequest({ item: quiet, skills, model }).extra.scene_starters).toBeUndefined();
  });

  it('a company scene carries its prompt as standing rules and the resolved skills as the starting set', () => {
    const item = companySceneItem(scene({ prompt: '你是发布经理。', skillIds: ['oskill_a1'] }));
    const request = buildSceneConversationRequest({ item, skills, model });
    expect(request.type).toBe('dream');
    expect(request.name).toBe('发布管理');
    expect(request.model).toBe(model);
    expect(request.extra).toMatchObject({
      workspace: '',
      custom_workspace: false,
      enabled_skills: ['release-signoff'],
      scene_id: 'scene_1',
    });
    // The role comes after the scene identity, so the model answers "who are you" as the scene.
    expect(request.extra.preset_rules).toContain('Scene: "发布管理"');
    expect(request.extra.preset_rules.endsWith('## Your role in this scene\n你是发布经理。')).toBe(true);
    expect(request.extra.scene_greeting?.role).toBe('你是发布经理。');
    expect(request.extra.selected_mcp_server_ids).toEqual([]);
  });

  it('a scene that names skills leaves the person’s other imported skills out, not the built-in ones', () => {
    const named = buildSceneConversationRequest({
      item: companySceneItem(scene({ skillIds: ['oskill_a1'] })),
      skills,
      model,
    });
    expect(named.extra.exclude_auto_inject_skills).toEqual(['imposter']);
    // A scene that names no skills keeps the usual defaults.
    const none = buildSceneConversationRequest({ item: companySceneItem(scene()), skills, model });
    expect(none.extra.exclude_auto_inject_skills).toBeUndefined();
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
    const quietRules = buildSceneConversationRequest({ item: quiet, skills, model }).extra.preset_rules;
    expect(quietRules).toContain('You are working inside a scene');
    expect(quietRules).not.toContain('understand first, then build');
  });

  it('the greeting shows the rules and hand-over only when the scene asks first, since only then are they sent', () => {
    const intent = {
      discovery: true,
      starters: [],
      questions: [],
      constraints: '1. 不编造数据。\n2、口径要写进报告。\n- 有问题先说。',
      deliverables: '一页结论摘要',
    };
    const asks = buildSceneConversationRequest({
      item: companySceneItem(scene({ prompt: '你是数据分析师。\n第二行。', intent })),
      skills,
      model,
    }).extra;
    expect(asks.scene_greeting?.rules).toEqual(['不编造数据。', '口径要写进报告。', '有问题先说。']);
    expect(asks.scene_greeting?.deliverables).toBe('一页结论摘要');
    expect(asks.scene_greeting?.role).toBe('你是数据分析师。');
    const quiet = buildSceneConversationRequest({
      item: companySceneItem(scene({ prompt: 'p', intent: { ...intent, discovery: false } })),
      skills,
      model,
    }).extra;
    expect(quiet.scene_greeting?.rules).toBeUndefined();
    expect(quiet.scene_greeting?.deliverables).toBeUndefined();
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
    hooks.activate.mockReset().mockResolvedValue({ selectedIds: ['omcp_1'], maxCount: 50 });
    hooks.sync.mockReset().mockResolvedValue({ written: 1, removed: 0, kept: 1 });
  });

  it('limits a company scene to its synced connectors when it opens', async () => {
    const item = companySceneItem(scene({ mcpIds: ['omcp_1'] }));
    await startSceneConversation(item, model);
    expect(hooks.create.mock.calls[0][0].extra.selected_mcp_server_ids).toEqual(['row_1']);
    expect(hooks.activate).toHaveBeenCalledWith({ sceneId: 'scene_1' });
    expect(hooks.sync).toHaveBeenCalledBefore(hooks.create);
  });

  it('does not create a zero-tool conversation when distribution fails', async () => {
    hooks.sync.mockResolvedValue(null);
    await expect(startSceneConversation(companySceneItem(scene({ mcpIds: ['omcp_1'] })), model)).resolves.toBeNull();
    expect(hooks.create).not.toHaveBeenCalled();
  });
  it('does not change selection for personal scenes', async () => {
    await startSceneConversation(personalSceneItem(newPersonalScene()), model);
    expect(hooks.activate).not.toHaveBeenCalled();
  });

  it('explains unavailable bundled dependencies without creating an empty scene or changing enterprise selection', async () => {
    const item = personalSceneItem(
      newPersonalScene({ name: 'Work', skillNames: ['one-work-assistant'], builtinMcpNames: ['one-browser'] })
    );
    await expect(startSceneConversation(item, model)).rejects.toThrow('SCENE_DEPENDENCY_UNAVAILABLE');
    expect(hooks.create).not.toHaveBeenCalled();
    expect(hooks.activate).not.toHaveBeenCalled();
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

  it('opens in the project folder chosen on the home page, and in a temporary workspace otherwise', () => {
    const item = companySceneItem(scene({ prompt: 'p' }));
    const withFolder = buildSceneConversationRequest({ item, skills, model, workspace: '  D:/projects/site  ' }).extra;
    expect(withFolder.workspace).toBe('D:/projects/site');
    expect(withFolder.custom_workspace).toBe(true);
    expect(withFolder.scene_greeting?.workspace).toBe('D:/projects/site');
    for (const workspace of [undefined, '', '   ']) {
      const extra = buildSceneConversationRequest({ item, skills, model, workspace }).extra;
      expect(extra.workspace).toBe('');
      expect(extra.custom_workspace).toBe(false);
      expect(extra.scene_greeting?.workspace).toBeUndefined();
    }
  });
});
