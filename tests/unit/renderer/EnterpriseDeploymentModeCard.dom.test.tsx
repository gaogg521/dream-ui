/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Message, Modal } from '@arco-design/web-react';
import EnterpriseDeploymentModeCard from '@/renderer/pages/settings/components/EnterpriseDeploymentModeCard';
import { webui, oneOrg } from '@/common/adapter/ipcBridge';

vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: {
    getStatus: { invoke: vi.fn() },
  },
  oneOrg: {
    context: { invoke: vi.fn() },
  },
}));

vi.mock('@/common', async () => {
  const bridge = await import('@/common/adapter/ipcBridge');
  return { ipcBridge: bridge };
});

let mockRole: 'client' | 'server' = 'server';
let mockServerUrl = '';
let mockServerUrlHistory: string[] = [];
const mockRefresh = vi.fn();
const mockPersistDeploymentRole = vi.fn().mockResolvedValue(undefined);
const mockPersistDeploymentServerUrl = vi.fn().mockResolvedValue(undefined);
const mockClearHistory = vi.fn().mockResolvedValue(undefined);

vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({
    loading: false,
    role: mockRole,
    serverUrl: mockServerUrl,
    normalizedServerUrl: null,
    serverUrlHistory: mockServerUrlHistory,
    isClient: mockRole === 'client',
    isServer: mockRole === 'server',
    refresh: mockRefresh,
  }),
  persistDeploymentRole: (...args: unknown[]) => mockPersistDeploymentRole(...args),
  persistDeploymentServerUrl: (...args: unknown[]) => mockPersistDeploymentServerUrl(...args),
  clearDeploymentServerUrlHistory: (...args: unknown[]) => mockClearHistory(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; url?: string }) =>
      opts?.defaultValue ? opts.defaultValue.replace('{{url}}', opts.url ?? '') : key,
  }),
}));

describe('EnterpriseDeploymentModeCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerUrl = '';
    mockServerUrlHistory = [];
    (window as unknown as { electronAPI?: unknown }).electronAPI = {};
    vi.mocked(oneOrg.context.invoke).mockResolvedValue({
      tenantId: 'default',
      tenantName: null,
      role: 'system_admin',
      isEnterprise: false,
      memberCount: 0,
    });
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('shows the resolved LAN address when the WebUI is reachable', async () => {
    mockRole = 'server';
    vi.mocked(webui.getStatus.invoke).mockResolvedValue({
      running: true,
      port: 25809,
      allowRemote: true,
      localUrl: 'http://localhost:25809',
      lanIP: '192.168.1.50',
      adminUsername: 'admin',
    });

    render(<EnterpriseDeploymentModeCard />);

    await waitFor(() => {
      expect(screen.getByText(/192\.168\.1\.50:25809/)).toBeInTheDocument();
    });
  });

  it('shows a fallback hint when the WebUI is not reachable from the LAN', async () => {
    mockRole = 'server';
    vi.mocked(webui.getStatus.invoke).mockResolvedValue({
      running: false,
      port: 25809,
      allowRemote: false,
      localUrl: 'http://localhost:25809',
      adminUsername: 'admin',
    });

    render(<EnterpriseDeploymentModeCard />);

    await waitFor(() => {
      expect(screen.getByText(/尚未开启可供局域网访问的 WebUI/)).toBeInTheDocument();
    });
  });

  it('blocks switching to server mode while still an active enterprise member in client mode', async () => {
    const user = userEvent.setup();
    mockRole = 'client';
    vi.mocked(oneOrg.context.invoke).mockResolvedValue({
      tenantId: 'tenant_1',
      tenantName: 'Acme',
      role: 'member',
      isEnterprise: true,
      memberCount: 3,
    });
    vi.mocked(webui.getStatus.invoke).mockResolvedValue({
      running: false,
      port: 25809,
      allowRemote: false,
      localUrl: 'http://localhost:25809',
      adminUsername: 'admin',
    });

    const warningSpy = vi
      .spyOn(Modal, 'warning')
      .mockImplementation(() => ({ close: vi.fn(), update: vi.fn() }) as never);

    render(<EnterpriseDeploymentModeCard />);

    await waitFor(() => {
      expect(oneOrg.context.invoke).toHaveBeenCalled();
    });

    // The role now applies the moment the radio is toggled — no separate
    // "保存" button for switching roles (BUG10: avoid a stale radio preview
    // while the rest of the page still reflects the old persisted role).
    await user.click(screen.getByText('本机作为服务器'));

    await waitFor(() => {
      expect(warningSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringMatching(/您当前的模式是客户端，且已加入项目组/),
        })
      );
    });
    expect(mockPersistDeploymentRole).not.toHaveBeenCalled();
  });

  it('asks for confirmation before switching to server, and only then applies the role', async () => {
    const user = userEvent.setup();
    mockRole = 'client';
    mockServerUrl = '192.168.1.10:25809';
    vi.mocked(oneOrg.context.invoke).mockResolvedValue({
      tenantId: 'default',
      tenantName: null,
      role: 'system_admin',
      isEnterprise: false,
      memberCount: 0,
    });
    vi.mocked(webui.getStatus.invoke).mockResolvedValue({
      running: false,
      port: 25809,
      allowRemote: false,
      localUrl: 'http://localhost:25809',
      adminUsername: 'admin',
    });
    vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);

    let confirmOnOk: (() => void) | undefined;
    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation((props) => {
      confirmOnOk = props?.onOk as () => void;
      return { close: vi.fn(), update: vi.fn() } as never;
    });

    render(<EnterpriseDeploymentModeCard />);

    await waitFor(() => {
      expect(oneOrg.context.invoke).toHaveBeenCalled();
    });

    await user.click(screen.getByText('本机作为服务器'));

    // Confirmation first — the role must NOT be applied by the click alone,
    // otherwise the saved server address silently stops being used.
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringMatching(/本机将作为项目组服务器托管项目组数据/) })
      );
    });
    expect(mockPersistDeploymentRole).not.toHaveBeenCalled();

    confirmOnOk?.();

    await waitFor(() => {
      // Role only — the address is persisted separately and survives the switch.
      expect(mockPersistDeploymentRole).toHaveBeenCalledWith('server');
    });
    expect(mockPersistDeploymentServerUrl).not.toHaveBeenCalled();
  });

  it('offers previously used server addresses in client mode', async () => {
    const user = userEvent.setup();
    mockRole = 'client';
    mockServerUrl = '';
    mockServerUrlHistory = ['http://192.168.1.10:25809', 'http://10.0.0.5:25809'];
    vi.mocked(webui.getStatus.invoke).mockResolvedValue({
      running: false,
      port: 25809,
      allowRemote: false,
      localUrl: 'http://localhost:25809',
      adminUsername: 'admin',
    });
    vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);

    render(<EnterpriseDeploymentModeCard />);

    const historyEntry = await screen.findByText('http://192.168.1.10:25809');
    await user.click(historyEntry);
    await user.click(screen.getByText('保存地址'));

    await waitFor(() => {
      expect(mockPersistDeploymentServerUrl).toHaveBeenCalledWith('http://192.168.1.10:25809');
    });
  });
});
