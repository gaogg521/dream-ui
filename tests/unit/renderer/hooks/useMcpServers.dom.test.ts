/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, screen, act, waitFor } from '@testing-library/react';

import { createElement } from 'react';
import {
  clearEnterpriseRemotePointer,
  setEnterpriseModeEnabled,
  setEnterpriseServerUrl,
  setEnterpriseSession,
} from '@/common/adapter/enterpriseMode';
import McpActivationPanel from '@/renderer/pages/settings/ToolsSettings/McpActivationPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  oneDevops: {
    getMcpSelection: { invoke: vi.fn().mockResolvedValue({ selectedIds: [] }) },
    getMcpCatalog: { invoke: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('@/renderer/utils/enterprise/teamSkillSync', () => ({ syncTeamMcp: vi.fn() }));

const { ensureBackendMcpCatalogMock } = vi.hoisted(() => ({
  ensureBackendMcpCatalogMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    extensions: {
      getMcpServers: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: ensureBackendMcpCatalogMock,
  subscribeMcpEnabledChanges: () => () => {},
}));

import { useMcpServers } from '@/renderer/hooks/mcp/useMcpServers';

describe('useMcpServers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureBackendMcpCatalogMock.mockResolvedValue({
      userServers: [],
      builtinServers: [],
      allServers: [],
    });
  });

  it('loads MCP catalog on mount', async () => {
    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    expect(ensureBackendMcpCatalogMock).toHaveBeenCalledTimes(1);
    expect(result.current.mcpServers).toEqual([]);
  });

  it('reloads the catalog and shows enterprise controls when joining, then restores local mode', async () => {
    clearEnterpriseRemotePointer();
    const company = { id: 'company', name: 'Company MCP' };
    ensureBackendMcpCatalogMock
      .mockResolvedValueOnce({ allServers: [] })
      .mockResolvedValueOnce({ allServers: [company] });
    const { result } = renderHook(() => useMcpServers());
    render(createElement(McpActivationPanel, { servers: [], onChanged: vi.fn() }));
    expect(screen.queryByText('settings.mcpQuotaDescription')).not.toBeInTheDocument();
    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    act(() => {
      setEnterpriseServerUrl('https://enterprise.example');
      setEnterpriseModeEnabled(true);
      setEnterpriseSession({ token: 'fixture', userId: 'member', username: 'tester' });
    });
    expect(await screen.findByText('settings.mcpQuotaDescription')).toBeInTheDocument();
    await waitFor(() => expect(result.current.mcpServers).toEqual([company]));

    act(() => clearEnterpriseRemotePointer());
    expect(screen.queryByText('settings.mcpQuotaDescription')).not.toBeInTheDocument();
    await waitFor(() => expect(result.current.mcpServers).toEqual([]));
  });

  it('does not fall back to configService business data when MCP catalog loading fails', async () => {
    ensureBackendMcpCatalogMock.mockRejectedValue(new Error('catalog failed'));

    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    expect(result.current.mcpServers).toEqual([]);
  });

  it('updates local MCP state without persisting business data outside the backend catalog', async () => {
    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => expect(result.current.isMcpServersLoading).toBe(false));

    act(() => {
      void result.current.saveMcpServers([
        {
          id: 'mcp-1',
          name: 'server-1',
          enabled: true,
          transport: { type: 'stdio', command: 'foo', args: [] },
          created_at: 1,
          updated_at: 1,
          original_json: '{}',
          builtin: false,
        },
      ]);
    });

    await waitFor(() => expect(result.current.mcpServers).toHaveLength(1));
  });
});
