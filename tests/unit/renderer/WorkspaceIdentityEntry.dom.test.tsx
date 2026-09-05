/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WorkspaceIdentityEntry from '@/renderer/components/layout/WorkspaceIdentityEntry';
import type { EnterpriseSession } from '@/common/adapter/enterpriseMode';

const mockNavigate = vi.fn();
let mockSession: EnterpriseSession | null = null;
let mockIsEnterprise = false;
let mockTenantName: string | null = null;
let mockIsClient = true;
let mockCompany: { companyId: string; name: string; origin: string; memberCount: number; viewerRole: string } | null =
  null;
let mockIsCompanyAdmin = false;

vi.mock('@/common/adapter/ipcBridge', () => ({
  oneOrg: { switchTenant: { invoke: vi.fn() } },
}));

vi.mock('@/common', async () => {
  const bridge = await import('@/common/adapter/ipcBridge');
  return { ipcBridge: bridge };
});

// `useDeploymentRole` is mocked below, but the REAL module still gets imported
// (and its module-scope effects still run) through other paths, and it reaches
// for `configService.whenReady()`. Without this stub that lands as an unhandled
// rejection AFTER the file's tests pass — vitest then reports
// "423 passed ... Errors 2 errors" and exits non-zero, which reads like the
// suite is green when the gate is actually red.
vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: () => Promise.resolve(),
    get: () => undefined,
    set: () => Promise.resolve(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Partial mock: the component (or something it renders) also reads
// `isEnterpriseModeEnabled`, and a hand-written factory that omits an export
// makes vitest throw on import rather than fall through to the real one — the
// whole file fails before a single assertion runs. Spread the real module so
// adding an export upstream cannot silently break this file again.
vi.mock('@/common/adapter/enterpriseMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/common/adapter/enterpriseMode')>()),
  getEnterpriseSession: () => mockSession,
}));

vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({
  ORG_CONTEXT_CHANGED_EVENT: 'org-context-changed',
  isOrgAdminRole: () => false,
  useOrgContext: () => ({
    loading: false,
    context: {
      tenantId: 'default',
      tenantName: mockTenantName,
      role: 'member',
      isEnterprise: mockIsEnterprise,
      memberCount: 0,
    },
  }),
}));

vi.mock('@renderer/pages/enterprise/hooks/useMyTenants', () => ({
  useMyTenants: () => ({ tenants: [] }),
}));

vi.mock('@renderer/pages/enterprise/hooks/useEnterpriseIdentity', () => ({
  useEnterpriseIdentity: () => ({ identity: null }),
}));

vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({ loading: false, isClient: mockIsClient, isServer: false }),
}));

// A local system_admin can self-establish a company (CompanyConsole's
// SetupCompanyCard) with zero SSO / project-group involvement — a third
// identity dimension independent of the two above. Defaults to "no company"
// so the three existing tests (none of which touch this axis) are unaffected.
vi.mock('@renderer/pages/enterprise/hooks/useCompanyIdentity', () => ({
  useCompanyIdentity: () => ({
    loading: false,
    company: mockCompany,
    isCompanyAdmin: mockIsCompanyAdmin,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@renderer/utils/enterprise/enterpriseBrowserLogin', () => ({
  openWebuiAdminLogin: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> & { defaultValue?: string }) => {
      const template = (opts?.defaultValue as string | undefined) ?? key;
      if (!opts) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        name in opts ? String(opts[name]) : `{{${name}}}`
      );
    },
  }),
}));

describe('WorkspaceIdentityEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = null;
    mockIsEnterprise = false;
    mockTenantName = null;
    mockIsClient = true;
    mockCompany = null;
    mockIsCompanyAdmin = false;
    (window as unknown as { electronAPI?: unknown }).electronAPI = {};
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('offers login + join for a guest with no SSO session', async () => {
    render(<WorkspaceIdentityEntry />);

    // The pill names the *workspace* now, not the person: with no project group
    // and no SSO session that is the personal workspace.
    fireEvent.click(screen.getByText('个人工作区'));

    fireEvent.click(await screen.findByText('登录 / 加入项目组'));
    expect(mockNavigate).toHaveBeenCalledWith('/enterprise/login');
  });

  it('offers only "join a project group" once signed in via enterprise SSO', async () => {
    // Enterprise ⊃ project group: an already-authenticated user has nothing
    // left to log in to. The menu must not offer the generic login entry —
    // and per the onboarding wizard (E6) "join" continues the SAME flow at
    // /enterprise/login (step 3 once a session exists), not the settings page.
    mockSession = { token: 't', username: 'zhaogao', name: '赵高' } as EnterpriseSession;
    render(<WorkspaceIdentityEntry />);

    fireEvent.click(screen.getByText('赵高'));

    fireEvent.click(await screen.findByText('加入项目组'));
    expect(screen.queryByText('登录 / 加入项目组')).not.toBeInTheDocument();
    expect(mockNavigate).toHaveBeenCalledWith('/enterprise/login');
  });

  it('drops both entries once a project group has been joined', async () => {
    mockSession = { token: 't', username: 'zhaogao', name: '赵高' } as EnterpriseSession;
    mockIsEnterprise = true;
    mockTenantName = '研发一组';
    render(<WorkspaceIdentityEntry />);

    // Workspace-first naming: once a project group is joined the pill shows the
    // group, not the signed-in person.
    fireEvent.click(screen.getByText('研发一组'));

    expect(await screen.findByText('项目组设置')).toBeInTheDocument();
    expect(screen.queryByText('加入项目组')).not.toBeInTheDocument();
    expect(screen.queryByText('登录 / 加入项目组')).not.toBeInTheDocument();
  });

  it('does not claim "个人版·未登录" for a local system_admin who has set up a company', async () => {
    // Regression: a local system_admin can self-establish a company via
    // "设立企业" without ever touching SSO or a project group. Before this
    // fix, that state still fell through to the generic personal/guest
    // label — actively wrong, since the viewer administers a real, reachable
    // company (found via /api/one/org/context showing isEnterprise:false
    // while /api/one/enterprise/me showed a live company for the same
    // session — the exact "UI says logged out, reality says admin"
    // contradiction this test locks down).
    mockIsClient = false;
    mockCompany = { companyId: 'c1', name: '测试科技公司', origin: 'manual', memberCount: 1, viewerRole: 'admin' };
    mockIsCompanyAdmin = true;
    render(<WorkspaceIdentityEntry />);

    // The pill names the workspace: the local company, not "个人工作区".
    expect(screen.queryByText('个人工作区')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('测试科技公司'));

    // The edition line must not claim "个人版 · 未登录" — the viewer
    // administers a real company. (Appears twice — trigger pill + open
    // dropdown header both show it — hence *AllBy*.)
    expect(screen.queryByText('个人版 · 未登录')).not.toBeInTheDocument();
    expect((await screen.findAllByText('企业管理员 · 未加入项目组')).length).toBeGreaterThan(0);

    // The hint must not promise "加入团队后可使用企业协作能力" as if no
    // company existed yet — it should name the company the viewer already
    // administers.
    expect(screen.queryByText(/当前为单机个人版/)).not.toBeInTheDocument();
    expect(screen.getByText(/你是本机「测试科技公司」的企业管理员/)).toBeInTheDocument();
  });
});
