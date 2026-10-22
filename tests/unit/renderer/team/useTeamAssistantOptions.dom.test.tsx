/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assistant, MarketplacePersona } from '@/common/types/agent/assistantTypes';

const mocks = vi.hoisted(() => ({
  setState: vi.fn(),
  install: vi.fn(),
  refresh: vi.fn(),
  refreshCatalog: vi.fn(),
  selectable: [] as Assistant[],
  all: [] as Assistant[],
  personas: [] as MarketplacePersona[],
}));

vi.mock('@/common', () => ({
  ipcBridge: { assistants: { setState: { invoke: (...args: unknown[]) => mocks.setState(...args) } } },
}));

vi.mock('@renderer/pages/conversation/hooks/useConversationAssistants', () => ({
  useConversationAssistants: () => ({
    presetAssistants: mocks.selectable,
    allAssistants: mocks.all,
    isLoading: false,
    refresh: mocks.refresh,
  }),
}));

vi.mock('@renderer/hooks/assistant/useMarketplacePersonas', () => ({
  useMarketplacePersonas: () => ({ personas: mocks.personas, install: mocks.install }),
}));

vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  refreshManagedAgentCatalogAndAssistants: () => mocks.refreshCatalog(),
}));

import { useTeamAssistantOptions } from '@/renderer/pages/team/hooks/useTeamAssistantOptions';

function makeAssistant(overrides: Partial<Assistant> & Pick<Assistant, 'id' | 'name' | 'source'>): Assistant {
  return {
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    preset_agent_type: 'dream',
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: 'online',
    team_selectable: true,
    deletable: false,
    ...overrides,
  } as Assistant;
}

describe('useTeamAssistantOptions', () => {
  const cli = makeAssistant({ id: 'cli', name: 'CLI', source: 'generated' });
  const template = makeAssistant({ id: 'word-creator', name: 'Word Creator', source: 'builtin', enabled: false });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectable = [cli];
    mocks.all = [cli, template];
    mocks.personas = [{ id: 'SecurityEngineer', name: 'Security', installed: false }];
  });

  it('offers disabled templates and marketplace experts without a search', () => {
    const { result } = renderHook(() => useTeamAssistantOptions('en-US'));

    expect(result.current.assistants.map((option) => [option.id, option.group, option.installed])).toEqual([
      ['cli', 'agent', true],
      ['word-creator', 'expert', false],
      ['SecurityEngineer', 'expert', false],
    ]);
  });

  it('adopts a disabled official template by enabling it, not by a marketplace install', async () => {
    mocks.setState.mockResolvedValue({ ...template, enabled: true });
    const { result } = renderHook(() => useTeamAssistantOptions('en-US'));

    let adopted: Awaited<ReturnType<typeof result.current.adoptAssistant>> | undefined;
    await act(async () => {
      adopted = await result.current.adoptAssistant('word-creator');
    });

    expect(mocks.setState).toHaveBeenCalledWith({ id: 'word-creator', enabled: true });
    expect(mocks.install).not.toHaveBeenCalled();
    expect(adopted).toMatchObject({ id: 'word-creator', installed: true, group: 'expert' });
  });

  it('adopts a marketplace expert by installing it', async () => {
    mocks.install.mockResolvedValue(makeAssistant({ id: 'SecurityEngineer', name: 'Security', source: 'user' }));
    const { result } = renderHook(() => useTeamAssistantOptions('en-US'));

    let adopted: Awaited<ReturnType<typeof result.current.adoptAssistant>> | undefined;
    await act(async () => {
      adopted = await result.current.adoptAssistant('SecurityEngineer');
    });

    expect(mocks.install).toHaveBeenCalledWith('SecurityEngineer');
    expect(mocks.setState).not.toHaveBeenCalled();
    expect(adopted).toMatchObject({ id: 'SecurityEngineer', installed: true });
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
