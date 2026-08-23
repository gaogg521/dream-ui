/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAssistantMock = vi.fn();
const listProvidersMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: {
      get: {
        invoke: (...args: unknown[]) => getAssistantMock(...args),
      },
    },
    mode: {
      listProviders: {
        invoke: (...args: unknown[]) => listProvidersMock(...args),
      },
    },
  },
}));

import { resolveDefaultTeamAgentModel } from '@/renderer/pages/team/components/teamCreateModelResolver';

describe('resolveDefaultTeamAgentModel', () => {
  beforeEach(() => {
    getAssistantMock.mockReset();
    listProvidersMock.mockReset();
  });

  it('prefers the assistant fixed default model over agent-level fallbacks', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'fixed', value: 'claude-sonnet-4-5-20250514' },
      },
      preferences: {
        last_model_id: 'claude-opus-4-1-20250805',
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-fixed',
      })
    ).resolves.toBe('claude-sonnet-4-5-20250514');
  });

  it('uses the assistant remembered auto model before falling back to backend defaults', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'auto' },
      },
      preferences: {
        last_model_id: 'gemini-2.5-pro',
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-auto',
      })
    ).resolves.toBe('gemini-2.5-pro');
  });

  it('falls back to the assistant engine backend when no assistant-owned model is stored', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'auto' },
      },
      preferences: {
        last_model_id: undefined,
      },
      engine: {
        agent_id: 'cc126dd5',
        agent: {
          id: 'cc126dd5',
          type: 'acp',
          source: 'builtin',
          acp_backend: 'gemini',
        },
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-gemini',
      })
    ).resolves.toBe('auto');
  });

  it('uses the provided assistant backend when detail lookup fails', async () => {
    getAssistantMock.mockRejectedValue(new Error('lookup failed'));

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-gemini',
        assistant_backend: 'gemini',
      })
    ).resolves.toBe('auto');
  });

  it('returns an empty model for antigravity assistants resolved from engine details', async () => {
    getAssistantMock.mockResolvedValue({
      defaults: {
        model: { mode: 'auto' },
      },
      preferences: {
        last_model_id: undefined,
      },
      engine: {
        agent_id: 'agy-agent',
        agent: {
          id: 'agy-agent',
          type: 'acp',
          source: 'builtin',
          acp_backend: 'antigravity',
        },
      },
    });

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-antigravity',
      })
    ).resolves.toBe('');
  });

  it('returns an empty model for the antigravity backend when detail lookup fails', async () => {
    getAssistantMock.mockRejectedValue(new Error('lookup failed'));

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_id: 'assistant-antigravity',
        assistant_backend: 'antigravity',
      })
    ).resolves.toBe('');
  });

  it('keeps the default placeholder for other ACP backends such as claude', async () => {
    await expect(
      resolveDefaultTeamAgentModel({
        assistant_backend: 'claude',
      })
    ).resolves.toBe('default');
  });

  it('resolves an aionrs teammate to the first enabled provider model, not a placeholder', async () => {
    getAssistantMock.mockRejectedValue(new Error('no assistant id'));
    listProvidersMock.mockResolvedValue([
      { id: 'p1', enabled: false, models: ['ignored-model'] },
      { id: 'p2', enabled: true, models: ['deepseek-v4-pro'], model_enabled: { 'deepseek-v4-pro': true } },
    ]);

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_backend: 'dream',
      })
    ).resolves.toBe('deepseek-v4-pro');
  });

  it('skips models explicitly disabled on an otherwise enabled provider', async () => {
    getAssistantMock.mockRejectedValue(new Error('no assistant id'));
    listProvidersMock.mockResolvedValue([
      {
        id: 'p1',
        enabled: true,
        models: ['disabled-model', 'usable-model'],
        model_enabled: { 'disabled-model': false },
      },
    ]);

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_backend: 'dream',
      })
    ).resolves.toBe('usable-model');
  });

  it('throws instead of returning a placeholder model when no provider is available for aionrs', async () => {
    getAssistantMock.mockRejectedValue(new Error('no assistant id'));
    listProvidersMock.mockResolvedValue([]);

    await expect(
      resolveDefaultTeamAgentModel({
        assistant_backend: 'dream',
      })
    ).rejects.toThrow(/no enabled model provider/i);
  });
});

describe('resolveDefaultTeamAgentModel — aionrs models must exist server-side', () => {
  beforeEach(() => {
    getAssistantMock.mockReset();
    listProvidersMock.mockReset();
  });

  const aionrsAssistant = (lastModelId?: string) => ({
    defaults: { model: { mode: 'auto' } },
    preferences: { last_model_id: lastModelId },
    engine: {
      agent_id: '632f31d2',
      agent: { id: '632f31d2', type: 'dream', source: 'builtin' },
    },
  });

  /// The failure this guards against: a marketplace persona (or any assistant
  /// whose provider was swapped since) remembers a model no enabled provider
  /// offers. Passing it through makes the server reject team creation with
  /// "no enabled provider offers model 'opus'", and the user cannot create the
  /// team at all.
  it('replaces a remembered model that no enabled provider offers', async () => {
    getAssistantMock.mockResolvedValue(aionrsAssistant('opus'));
    listProvidersMock.mockResolvedValue([{ id: 'p1', enabled: true, models: ['kimi-k2-6', 'minimax-2-7'] }]);

    await expect(resolveDefaultTeamAgentModel({ assistant_id: 'expert-with-stale-model' })).resolves.toBe('kimi-k2-6');
  });

  it('keeps a remembered model that an enabled provider does offer', async () => {
    getAssistantMock.mockResolvedValue(aionrsAssistant('minimax-2-7'));
    listProvidersMock.mockResolvedValue([{ id: 'p1', enabled: true, models: ['kimi-k2-6', 'minimax-2-7'] }]);

    await expect(resolveDefaultTeamAgentModel({ assistant_id: 'expert-with-live-model' })).resolves.toBe('minimax-2-7');
  });

  it('skips a model the provider has individually disabled', async () => {
    getAssistantMock.mockResolvedValue(aionrsAssistant('kimi-k2-6'));
    listProvidersMock.mockResolvedValue([
      { id: 'p1', enabled: true, models: ['kimi-k2-6', 'minimax-2-7'], model_enabled: { 'kimi-k2-6': false } },
    ]);

    await expect(resolveDefaultTeamAgentModel({ assistant_id: 'expert-disabled-model' })).resolves.toBe('minimax-2-7');
  });
});
