/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  assistantToOption,
  buildTeamMemberCatalog,
  filterTeamSupportedAssistants,
  matchesAssistantQuery,
} from '@/renderer/pages/team/components/assistantSelectUtils';
import type { Assistant, MarketplacePersona } from '@/common/types/agent/assistantTypes';

describe('assistantSelectUtils', () => {
  it('localizes assistant option names for the active locale', () => {
    const bareAssistant = makeAssistant({
      id: 'bare-dream-engine',
      name: 'Aion CLI',
      name_i18n: { 'zh-CN': 'Aion 命令行' },
      source: 'generated',
      preset_agent_type: 'dream-engine',
    });

    const option = assistantToOption(bareAssistant, 'zh-CN');

    expect(option.name).toBe('Aion 命令行');
  });

  it('preserves backend-provided team availability for selectable assistants', () => {
    const remoteAssistant = makeAssistant({
      id: 'bare-remote',
      name: 'Remote Runner',
      source: 'generated',
      preset_agent_type: 'remote',
      team_selectable: true,
      team_block_reason: undefined,
    });

    const [option] = filterTeamSupportedAssistants([assistantToOption(remoteAssistant)]);

    expect(option.team_selectable).toBe(true);
    expect(option.team_block_reason).toBeUndefined();
  });

  it('keeps unchecked assistants selectable when backend projection allows team use', () => {
    const assistant = makeAssistant({
      id: 'unchecked',
      name: 'Unchecked',
      source: 'generated',
      preset_agent_type: 'dream-engine',
      agent_status: 'unchecked',
      team_selectable: true,
    });

    const option = assistantToOption(assistant);

    expect(option.team_selectable).toBe(true);
  });
});

const persona = (id: string, name: string, description?: string): MarketplacePersona => ({
  id,
  name,
  description,
  installed: false,
});

describe('buildTeamMemberCatalog', () => {
  const cliOnline = makeAssistant({ id: 'cli-a', name: 'CLI A', source: 'generated', preset_agent_type: 'claude' });
  const cliBlocked = makeAssistant({
    id: 'cli-b',
    name: 'CLI B',
    source: 'generated',
    preset_agent_type: 'cursor',
    team_selectable: false,
    team_block_reason: 'needs login',
  });
  const cliLater = makeAssistant({ id: 'cli-c', name: 'CLI C', source: 'generated', preset_agent_type: 'kilo' });
  const butler = makeAssistant({ id: 'butler', name: 'Butler', source: 'builtin', preset_agent_type: 'dream' });
  const disabledTemplate = makeAssistant({
    id: 'word-creator',
    name: 'Word Creator',
    source: 'builtin',
    preset_agent_type: 'dream',
    enabled: false,
  });
  it('lists experts up front instead of only on search, after the agents', () => {
    const catalog = buildTeamMemberCatalog({
      selectable: [cliOnline, cliBlocked, cliLater, butler],
      all: [cliOnline, cliBlocked, cliLater, butler, disabledTemplate],
      marketplacePersonas: [persona('SecurityEngineer', '安全工程师', '全方位保障系统安全')],
      localeKey: 'en-US',
    });

    expect(catalog.map((option) => [option.id, option.group, option.installed])).toEqual([
      ['cli-a', 'agent', true],
      ['cli-c', 'agent', true],
      // A CLI that cannot join right now sinks to the end of its section rather than
      // pushing the experts further out of view.
      ['cli-b', 'agent', true],
      ['butler', 'expert', true],
      // Disabled official templates and marketplace personas are adoptable on click.
      ['word-creator', 'expert', false],
      ['SecurityEngineer', 'expert', false],
    ]);
  });

  it('does not list a marketplace persona twice once it is installed', () => {
    const installed = makeAssistant({
      id: 'SecurityEngineer',
      name: '安全工程师',
      source: 'user',
      preset_agent_type: 'dream',
    });
    const catalog = buildTeamMemberCatalog({
      selectable: [installed],
      all: [installed],
      marketplacePersonas: [persona('SecurityEngineer', '安全工程师')],
      localeKey: 'en-US',
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ id: 'SecurityEngineer', installed: true, group: 'expert' });
  });

  it('matches a search on what an expert does, not only its name', () => {
    const [option] = buildTeamMemberCatalog({
      selectable: [],
      all: [],
      marketplacePersonas: [persona('SecurityEngineer', 'Shield', '全方位保障系统安全')],
      localeKey: 'en-US',
    });

    expect(matchesAssistantQuery(option, '安全')).toBe(true);
    expect(matchesAssistantQuery(option, 'shield')).toBe(true);
    expect(matchesAssistantQuery(option, '视频')).toBe(false);
  });
});

function makeAssistant(
  overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'name' | 'source' | 'preset_agent_type'>
): Assistant {
  return {
    id: overrides.id,
    source: overrides.source,
    name: overrides.name,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    preset_agent_type: overrides.preset_agent_type,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    avatar: undefined,
    agent_status: 'online',
    team_selectable: true,
    team_block_reason: undefined,
    deletable: false,
    ...overrides,
  };
}
