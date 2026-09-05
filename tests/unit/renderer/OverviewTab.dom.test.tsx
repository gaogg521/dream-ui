/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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

describe('OverviewTab — local hosting retired', () => {
  // A machine whose stored deployment role still says `server`. There is no
  // longer any UI that can put it there — only a config written before the
  // enterprise edition was split out, or `markDeploymentAsServer`.
  const legacyServerContext: OrgContext = {
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

  /**
   * The create form used to be offered here and called
   * `/api/one/org/create`, which this build answers with 501 — the personal
   * edition does not compile the governance crates that host a project
   * group. Offering it produced a failure that explained none of that.
   */
  it('offers no local create path, and explains where hosting went', async () => {
    render(
      <MemoryRouter>
        <OverviewTab context={legacyServerContext} error={null} unauthorized={false} onChanged={vi.fn()} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/个人版不提供项目组托管能力/)).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText('企业名称')).toBeNull();
    expect(screen.queryByRole('button', { name: '创建' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重置本机企业数据' })).toBeNull();
    expect(oneOrg.create.invoke).not.toHaveBeenCalled();
    expect(oneOrg.resetLocal.invoke).not.toHaveBeenCalled();
  });
});
