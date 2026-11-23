/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  clearEnterpriseRemotePointer,
  setEnterpriseModeEnabled,
  setEnterpriseServerUrl,
  setEnterpriseSession,
} from '@/common/adapter/enterpriseMode';

const { getClientBusinessSettingMock, setClientBusinessSettingMock, mcpServiceMock } = vi.hoisted(() => ({
  getClientBusinessSettingMock: vi.fn(),
  setClientBusinessSettingMock: vi.fn(),
  mcpServiceMock: {
    listServers: { invoke: vi.fn() },
    toggleServer: { invoke: vi.fn() },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: getClientBusinessSettingMock,
  setClientBusinessSetting: setClientBusinessSettingMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: mcpServiceMock,
}));

import { ensureBackendMcpCatalog, setMcpServersEnabled } from '@/renderer/hooks/mcp/catalog';

describe('ensureBackendMcpCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientBusinessSettingMock.mockResolvedValue([]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([
      {
        id: 'user-1',
        name: 'user one',
        enabled: true,
        transport: { type: 'stdio', command: 'user', args: [] },
        created_at: 2,
        updated_at: 2,
        original_json: '{}',
        builtin: false,
      },
    ]);
  });

  it('reads MCP catalog from backend settings without falling back to configService', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'builtin-1',
        name: 'builtin one',
        enabled: true,
        transport: { type: 'stdio', command: 'builtin', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: true,
      },
    ]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toHaveLength(1);
    expect(result.builtinServers).toHaveLength(1);
    expect(result.allServers).toHaveLength(2);
  });

  it('does not re-import legacy user MCP rows from backend client settings at runtime', async () => {
    getClientBusinessSettingMock.mockResolvedValue([
      {
        id: 'legacy-user-1',
        name: 'legacy user server',
        enabled: true,
        transport: { type: 'stdio', command: 'legacy-user', args: [] },
        created_at: 1,
        updated_at: 1,
        original_json: '{}',
        builtin: false,
      },
    ]);
    mcpServiceMock.listServers.invoke.mockResolvedValue([]);

    const result = await ensureBackendMcpCatalog();

    expect(result.userServers).toEqual([]);
    expect(result.builtinServers).toEqual([]);
    expect(result.allServers).toEqual([]);
  });
});

it('persists state for catalog and settings rows with the same action, and avoids retrying an already-enabled toggle', async () => {
  const fixture = (id: string, builtin: boolean) => ({
    id,
    name: id,
    builtin,
    enabled: false,
    transport: { type: 'stdio', command: 'fixture' },
  });
  const unrelated = fixture('unrelated', true);
  const local = fixture('local', true);
  const backend = fixture('backend', true);
  let settings = [local, unrelated];
  let backendState = backend;
  getClientBusinessSettingMock.mockImplementation(async () => settings);
  setClientBusinessSettingMock.mockImplementation(async (_key, rows) => {
    settings = rows;
  });
  mcpServiceMock.listServers.invoke.mockImplementation(async () => [backendState]);
  mcpServiceMock.toggleServer.invoke.mockImplementation(async () => {
    backendState = { ...backendState, enabled: !backendState.enabled };
    return backendState;
  });

  await Promise.all([
    setMcpServersEnabled([backend.id, local.id], true),
    setMcpServersEnabled([backend.id, local.id], true),
  ]);
  expect(mcpServiceMock.toggleServer.invoke).toHaveBeenCalledExactlyOnceWith({ id: backend.id });
  expect(settings).toEqual([{ ...local, enabled: true }, unrelated]);
  expect(setClientBusinessSettingMock).toHaveBeenCalledOnce();

  await setMcpServersEnabled([local.id], false);
  expect(settings).toEqual([local, unrelated]);
  expect(backendState.enabled).toBe(true);
});

it('does not toggle a server after the active connection changes during catalog loading', async () => {
  clearEnterpriseRemotePointer();
  mcpServiceMock.toggleServer.invoke.mockClear();
  getClientBusinessSettingMock.mockResolvedValue([]);
  let complete: (servers: unknown[]) => void = () => {};
  let started: () => void = () => {};
  const loading = new Promise<void>((resolve) => {
    started = resolve;
  });
  mcpServiceMock.listServers.invoke.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const pending = setMcpServersEnabled(['same-id'], true);
  await loading;
  setEnterpriseServerUrl('https://company.example');
  setEnterpriseModeEnabled(true);
  setEnterpriseSession({ token: 'fixture', userId: 'member', username: 'tester' });
  try {
    complete([{ id: 'same-id', name: 'Test', enabled: false, transport: { type: 'stdio', command: 'fixture' } }]);
    await expect(pending).rejects.toThrow('MCP_SCOPE_CHANGED');
    expect(mcpServiceMock.toggleServer.invoke).not.toHaveBeenCalled();
  } finally {
    clearEnterpriseRemotePointer();
  }
});
