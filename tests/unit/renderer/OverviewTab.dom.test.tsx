/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Message, Modal } from '@arco-design/web-react';
import OverviewTab from '@/renderer/pages/enterprise/components/OverviewTab';
import { oneOrg, webui } from '@/common/adapter/ipcBridge';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { OrgContext } from '@/common/types/org/orgTypes';

vi.mock('@/common/adapter/ipcBridge', () => ({
  oneOrg: {
    join: { invoke: vi.fn() },
    exit: { invoke: vi.fn() },
    create: { invoke: vi.fn() },
    resetLocal: { invoke: vi.fn() },
  },
  webui: {
    getStatus: { invoke: vi.fn() },
  },
}));

// `@/common`'s `ipcBridge` export (`export * as ipcBridge from './adapter/ipcBridge'`) must
// point at the SAME mocked module instance as the direct `@/common/adapter/ipcBridge` import
// above, so `ipcBridge.oneOrg.create.invoke` (used by the component) and `oneOrg.create.invoke`
// (used by this test to configure the mock) are the same function.
vi.mock('@/common', async () => {
  const bridge = await import('@/common/adapter/ipcBridge');
  return { ipcBridge: bridge };
});

vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({
    loading: false,
    role: 'server',
    serverUrl: '',
    normalizedServerUrl: null,
    isClient: false,
    isServer: true,
    refresh: vi.fn(),
  }),
  markDeploymentAsServer: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

describe('OverviewTab — stale local enterprise data recovery', () => {
  // A personal-mode (non-enterprise) context — required to reach the "Create
  // Enterprise" section; `context: null` short-circuits the component to `null`.
  const personalContext: OrgContext = {
    tenantId: 'default',
    tenantName: null,
    role: 'system_admin',
    isEnterprise: false,
    memberCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
    vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
    vi.spyOn(Message, 'warning').mockImplementation(() => undefined as never);
    vi.mocked(webui.getStatus.invoke).mockRejectedValue(new Error('no webui in test'));
  });

  it('shows a reset affordance when create fails with ALREADY_HOSTS_ENTERPRISE, and resetting clears it', async () => {
    const user = userEvent.setup();
    vi.mocked(oneOrg.create.invoke).mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/one/org/create',
        status: 403,
        body: { success: false, error: 'already hosts', code: 'ALREADY_HOSTS_ENTERPRISE' },
      })
    );
    vi.mocked(oneOrg.resetLocal.invoke).mockResolvedValue({
      archivedTenantCount: 1,
      archivedMemberCount: 1,
      archivePath: '/tmp/enterprise-archives/enterprise-1.json',
    });

    const onChanged = vi.fn();
    render(<OverviewTab context={personalContext} error={null} onChanged={onChanged} />);

    await user.type(screen.getByPlaceholderText('企业名称'), 'Acme');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(screen.getByText(/检测到本机保留有历史企业数据/)).toBeInTheDocument();
    });

    const confirmSpy = vi.spyOn(Modal, 'confirm').mockImplementation((config) => {
      void config.onOk?.();
      return { close: vi.fn(), update: vi.fn() } as never;
    });

    await user.click(screen.getByRole('button', { name: '重置本机企业数据' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(oneOrg.resetLocal.invoke).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByText(/检测到本机保留有历史企业数据/)).not.toBeInTheDocument();
    });
  });

  it('does not show the reset affordance for other create failures', async () => {
    const user = userEvent.setup();
    vi.mocked(oneOrg.create.invoke).mockRejectedValue(new Error('network down'));

    render(<OverviewTab context={personalContext} error={null} onChanged={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('企业名称'), 'Acme');
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(Message.error).toHaveBeenCalled();
    });
    expect(screen.queryByText(/检测到本机保留有历史企业数据/)).not.toBeInTheDocument();
  });
});
