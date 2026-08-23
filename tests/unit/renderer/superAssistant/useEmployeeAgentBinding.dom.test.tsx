/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assistantsRef, catalogRef, providersRef, personasRef, installMock, setStateMock } = vi.hoisted(() => ({
  assistantsRef: { current: [] as unknown[] },
  catalogRef: { current: [] as unknown[] },
  providersRef: { current: [] as unknown[] },
  personasRef: { current: [] as unknown[] },
  installMock: vi.fn(),
  setStateMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    assistants: { setState: { invoke: (...args: unknown[]) => setStateMock(...args) } },
  },
}));

vi.mock('@renderer/hooks/assistant/useAssistantList', () => ({
  useAssistantList: () => ({ assistants: assistantsRef.current, loading: false }),
}));

vi.mock('@renderer/hooks/assistant/useMarketplacePersonas', () => ({
  useMarketplacePersonas: () => ({
    personas: personasRef.current,
    loading: false,
    install: installMock,
    reloadMarketplace: vi.fn(),
  }),
}));

vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgentRuntimeCatalog: () => catalogRef.current,
  refreshManagedAgentCatalogAndAssistants: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: providersRef.current,
    getAvailableModels: (provider: { models?: string[] }) => provider.models ?? [],
    formatModelLabel: (_p: unknown, m?: string) => m ?? '',
  }),
}));

import { NO_EXPERT_ID, useEmployeeAgentBinding } from '@/renderer/pages/superAssistant/hooks/useEmployeeAgentBinding';

const CLAUDE_AGENT = { id: 'agent_claude', name: 'Claude Code', backend: 'claude', agent_type: 'acp', enabled: true };
const AIONRS_AGENT = { id: 'agent_aionrs', name: '1ONE CLI', backend: null, agent_type: 'aionrs', enabled: true };

function assistant(
  id: string,
  agentId: string,
  backendType: string,
  { source = 'builtin', enabled = true, acpBackend }: { source?: string; enabled?: boolean; acpBackend?: string } = {}
) {
  return {
    id,
    name: id,
    source,
    agent_id: agentId,
    agent: { type: backendType, source: 'internal', acp_backend: acpBackend },
    models: ['claude-sonnet-4-6'],
    enabled,
  };
}

describe('useEmployeeAgentBinding', () => {
  beforeEach(() => {
    installMock.mockReset();
    setStateMock.mockReset();
    assistantsRef.current = [
      assistant('acp_persona', 'agent_claude', 'acp', { acpBackend: 'claude' }),
      assistant('cli_persona', 'agent_aionrs', 'aionrs'),
      // Bare CLI rows are backends, not experts — they must never be offered.
      assistant('bare:632f31d2', 'agent_aionrs', 'aionrs', { source: 'generated' }),
      // Official templates ship disabled; they must still be offered.
      assistant('disabled_official', 'agent_aionrs', 'aionrs', { enabled: false }),
    ];
    personasRef.current = [];
    catalogRef.current = [CLAUDE_AGENT, AIONRS_AGENT];
    providersRef.current = [{ id: 'prov_1', name: 'Gateway', platform: 'openai', models: ['glm-5-2', 'kimi-k3'] }];
  });

  it('offers real experts only — never the bare CLI rows', () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());
    const ids = result.current.assistants.map((a) => a.id);
    expect(ids).toContain('acp_persona');
    // A disabled official expert must still be listed (this is the regression
    // that made the picker show only the CLI assistants).
    expect(ids).toContain('disabled_official');
    expect(ids).not.toContain('bare:632f31d2');
  });

  it('enables a disabled official expert instead of trying to install it', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    await act(async () => {
      await result.current.installAndSelectAssistant('disabled_official');
    });

    expect(setStateMock).toHaveBeenCalledWith({ id: 'disabled_official', enabled: true });
    expect(installMock).not.toHaveBeenCalled();
    expect(result.current.selectedAssistantId).toBe('disabled_official');
  });

  it('installs a marketplace persona that does not exist locally yet', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    await act(async () => {
      await result.current.installAndSelectAssistant('MarketOnlyExpert');
    });

    expect(installMock).toHaveBeenCalledWith('MarketOnlyExpert');
    expect(setStateMock).not.toHaveBeenCalled();
  });

  it('supports a backend-only employee via the explicit "no expert" choice', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('acp_persona'));
    await waitFor(() => expect(result.current.selectedAssistant).toBeDefined());

    act(() => result.current.selectAssistant(NO_EXPERT_ID));
    await waitFor(() => expect(result.current.selectedAssistant).toBeUndefined());

    // With no expert the backend field carries the whole decision.
    act(() => result.current.setBackendAgentId('agent_claude'));
    await waitFor(() => expect(result.current.buildBinding()).toBeDefined());
    const bound = result.current.buildBinding();
    expect(bound?.agentType).toBe('claude');
    expect(bound?.assistantId).toBeUndefined();
    expect(bound?.agentIdOverride).toBeUndefined();
  });

  it('derives the backend from the selected expert', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('acp_persona'));
    await waitFor(() => expect(result.current.selectedBackendAgentId).toBe('agent_claude'));
    expect(result.current.resolvedBackend).toBe('claude');
    expect(result.current.isAionrsBackend).toBe(false);
  });

  it('keeps a manual backend override across later expert switches', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('acp_persona'));
    await waitFor(() => expect(result.current.selectedBackendAgentId).toBe('agent_claude'));

    // Manual override latches...
    act(() => result.current.setBackendAgentId('agent_aionrs'));
    await waitFor(() => expect(result.current.resolvedBackend).toBe('aionrs'));

    // ...so switching the expert must NOT snap the backend back.
    act(() => result.current.selectAssistant('cli_persona'));
    await waitFor(() => expect(result.current.selectedBackendAgentId).toBe('agent_aionrs'));
  });

  it('auto-picks a provider model for aionrs and reports it as a top-level model', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('cli_persona'));
    await waitFor(() => expect(result.current.isAionrsBackend).toBe(true));
    await waitFor(() => expect(result.current.buildBinding()).toBeDefined());

    const bound = result.current.buildBinding();
    expect(bound?.agentType).toBe('aionrs');
    expect(bound?.assistantId).toBe('cli_persona');
    expect(bound?.model).toEqual({ provider_id: 'prov_1', model: 'glm-5-2', use_model: 'glm-5-2' });
    // Backend equals the persona's own agent, so no override is reported.
    expect(bound?.agentIdOverride).toBeUndefined();
  });

  it('never reports a top-level model for an ACP backend', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('acp_persona'));
    await waitFor(() => expect(result.current.buildBinding()).toBeDefined());

    const bound = result.current.buildBinding();
    expect(bound?.agentType).toBe('claude');
    // The conversation layer hard-rejects a top-level model on non-aionrs types.
    expect(bound?.model).toBeUndefined();
  });

  it('reports the backend override only when it differs from the expert default', async () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('acp_persona'));
    await waitFor(() => expect(result.current.selectedBackendAgentId).toBe('agent_claude'));

    act(() => result.current.setBackendAgentId('agent_aionrs'));
    await waitFor(() => expect(result.current.buildBinding()?.agentIdOverride).toBe('agent_aionrs'));
  });

  it('cannot be submitted without an expert', () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());
    expect(result.current.buildBinding()).toBeUndefined();
  });

  it('cannot be submitted for aionrs when no provider is configured', async () => {
    providersRef.current = [];
    const { result } = renderHook(() => useEmployeeAgentBinding());

    act(() => result.current.selectAssistant('cli_persona'));
    await waitFor(() => expect(result.current.isAionrsBackend).toBe(true));

    expect(result.current.hasAionrsProvider).toBe(false);
    expect(result.current.buildBinding()).toBeUndefined();
  });

  it('restores an existing binding, including a stored provider', async () => {
    const { result } = renderHook(() =>
      useEmployeeAgentBinding({
        assistantId: 'cli_persona',
        agentIdOverride: 'agent_aionrs',
        modelId: 'kimi-k3',
        model: { provider_id: 'prov_1', model: 'kimi-k3', use_model: 'kimi-k3' },
      })
    );

    await waitFor(() => expect(result.current.buildBinding()).toBeDefined());
    expect(result.current.buildBinding()?.model).toEqual({
      provider_id: 'prov_1',
      model: 'kimi-k3',
      use_model: 'kimi-k3',
    });
  });

  it('exposes branded backend labels from the catalog rather than raw ids', () => {
    const { result } = renderHook(() => useEmployeeAgentBinding());
    expect(result.current.backendOptions.map((option) => option.label)).toContain('1ONE CLI');
  });
});
