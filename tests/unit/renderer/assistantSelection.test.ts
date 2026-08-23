/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Assistant, AssistantAgentStatus } from '@/common/types/agent/assistantTypes';
import {
  assistantOrderAfterToggle,
  isInstalledGeneratedCliAssistant,
  selectableAssistants,
} from '@/renderer/utils/model/assistantSelection';

const mk = (
  id: string,
  source: Assistant['source'],
  sort_order: number,
  enabled = true,
  agent_status: AssistantAgentStatus = 'online',
  agent?: Assistant['agent']
): Assistant =>
  ({
    id,
    source,
    name: id,
    name_i18n: {},
    description_i18n: {},
    enabled,
    sort_order,
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status,
    agent,
    team_selectable: true,
    deletable: source === 'user',
  }) as Assistant;

describe('selectableAssistants', () => {
  it('keeps the legacy source order when no preference exists', () => {
    const result = selectableAssistants([
      mk('builtin-a', 'builtin', 5),
      mk('user-b', 'user', 20),
      mk('cli-a', 'generated', 30),
      mk('user-a', 'user', 10),
      mk('cli-b', 'generated', 40),
    ]);
    expect(result.map((a) => a.id)).toEqual(['cli-a', 'cli-b', 'user-a', 'user-b', 'builtin-a']);
  });

  it('drops disabled assistants', () => {
    const result = selectableAssistants([
      mk('cli-on', 'generated', 10, true),
      mk('cli-off', 'generated', 20, false),
      mk('user-off', 'user', 30, false),
    ]);
    expect(result.map((a) => a.id)).toEqual(['cli-on']);
  });

  it('keeps CLI agents ahead of official even when official has a lower sort_order', () => {
    const result = selectableAssistants([mk('official', 'builtin', 1), mk('cli', 'generated', 999)]);
    expect(result[0].id).toBe('cli');
  });

  it('shows installed generated CLI assistants (online or offline), hides missing/unchecked', () => {
    const result = selectableAssistants([
      mk('bare-aionrs', 'generated', 1, true, 'online', { type: 'aionrs', source: 'internal' }),
      mk('bare-claude', 'generated', 2, true, 'online', { type: 'acp', source: 'builtin', acp_backend: 'claude' }),
      // Cursor's `agent`: installed but the ACP handshake failed (needs login) → offline, still shown.
      mk('bare-cursor', 'generated', 3, true, 'offline', { type: 'acp', source: 'builtin', acp_backend: 'cursor' }),
      mk('bare-codex', 'generated', 4, true, 'missing', { type: 'acp', source: 'builtin', acp_backend: 'codex' }),
      mk('bare-gemini', 'generated', 5, true, 'unchecked', { type: 'acp', source: 'builtin', acp_backend: 'gemini' }),
    ]);
    expect(result.map((a) => a.id)).toEqual(['bare-aionrs', 'bare-claude', 'bare-cursor']);
  });

  it('applies one preferred order across CLI, custom, and official assistants', () => {
    const assistants = [mk('official', 'builtin', 1), mk('custom', 'user', 1), mk('cli', 'generated', 1)];

    const result = selectableAssistants(assistants, ['official', 'cli', 'custom']);

    expect(result.map((assistant) => assistant.id)).toEqual(['official', 'cli', 'custom']);
  });

  it('ignores duplicate and stale IDs, then appends new assistants deterministically', () => {
    const assistants = [mk('official-new', 'builtin', 2), mk('custom-known', 'user', 1), mk('cli-new', 'generated', 3)];

    const result = selectableAssistants(assistants, ['missing', 'custom-known', 'custom-known']);

    expect(result.map((assistant) => assistant.id)).toEqual(['custom-known', 'cli-new', 'official-new']);
  });
});

describe('assistantOrderAfterToggle', () => {
  const assistants = [
    mk('cli', 'generated', 1),
    mk('custom', 'user', 1),
    mk('official', 'builtin', 1),
    mk('disabled', 'builtin', 2, false),
  ];

  it('removes a disabled assistant from the enabled order', () => {
    expect(assistantOrderAfterToggle(assistants, ['official', 'cli', 'custom'], 'cli', false)).toEqual([
      'official',
      'custom',
    ]);
  });

  it('appends a re-enabled assistant to the end', () => {
    expect(assistantOrderAfterToggle(assistants, ['official', 'cli', 'custom'], 'disabled', true)).toEqual([
      'official',
      'cli',
      'custom',
      'disabled',
    ]);
  });
});

describe('isInstalledGeneratedCliAssistant', () => {
  it('always shows non-generated assistants regardless of agent status', () => {
    expect(isInstalledGeneratedCliAssistant(mk('u', 'user', 1, true, 'missing'))).toBe(true);
    expect(isInstalledGeneratedCliAssistant(mk('b', 'builtin', 1, true, 'offline'))).toBe(true);
  });

  it('always shows the built-in aionrs assistant even when unchecked', () => {
    const aionrs = mk('bare-aionrs', 'generated', 1, true, 'unchecked', { type: 'dream', source: 'internal' });
    expect(isInstalledGeneratedCliAssistant(aionrs)).toBe(true);
  });

  it('treats offline (installed but handshake failed) generated CLIs as installed', () => {
    const cursor = mk('bare-cursor', 'generated', 1, true, 'offline', {
      type: 'acp',
      source: 'builtin',
      acp_backend: 'cursor',
    });
    expect(isInstalledGeneratedCliAssistant(cursor)).toBe(true);
  });

  it('hides missing and unchecked generated CLIs', () => {
    const missing = mk('bare-codex', 'generated', 1, true, 'missing', {
      type: 'acp',
      source: 'builtin',
      acp_backend: 'codex',
    });
    const unchecked = mk('bare-gemini', 'generated', 1, true, 'unchecked', {
      type: 'acp',
      source: 'builtin',
      acp_backend: 'gemini',
    });
    expect(isInstalledGeneratedCliAssistant(missing)).toBe(false);
    expect(isInstalledGeneratedCliAssistant(unchecked)).toBe(false);
  });
});
