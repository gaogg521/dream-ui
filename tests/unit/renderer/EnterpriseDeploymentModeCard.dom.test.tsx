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

  /**
   * Hosting a project group moved to the enterprise edition, whose governance
   * crates this personal build does not compile in — `/api/one/org/create`
   * answers 501 here. The role picker used to offer "本机作为服务器" anyway,
   * so the flow ran, flipped the persisted role, and only failed later at the
   * API with an error that named none of that. The option must now be
   * unreachable, and say why.
   */
  it('does not offer server mode, and explains that hosting needs the enterprise edition', async () => {
    const user = userEvent.setup();
    mockRole = 'client';
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

    const confirmSpy = vi
      .spyOn(Modal, 'confirm')
      .mockImplementation(() => ({ close: vi.fn(), update: vi.fn() }) as never);
    const warningSpy = vi
      .spyOn(Modal, 'warning')
      .mockImplementation(() => ({ close: vi.fn(), update: vi.fn() }) as never);

    render(<EnterpriseDeploymentModeCard />);

    await waitFor(() => {
      expect(oneOrg.context.invoke).toHaveBeenCalled();
    });

    const serverRadio = screen.getByText('本机作为服务器').closest('label') as HTMLLabelElement;
    expect(serverRadio.querySelector('input')?.disabled).toBe(true);
    expect(screen.getByText(/需要部署企业版服务端，个人版不提供项目组托管能力/)).toBeInTheDocument();

    // Clicking it must be inert — no dialog, and above all no persisted role
    // change that would leave the machine claiming a mode it cannot serve.
    await user.click(screen.getByText('本机作为服务器'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(warningSpy).not.toHaveBeenCalled();
    expect(mockPersistDeploymentRole).not.toHaveBeenCalled();
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
