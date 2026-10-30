/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The SSO tiles used to render as `disabled` when unconfigured, which
 * swallowed the click that would have explained why — leaving a row of dead
 * grey tiles and no way to find out whether the fix was "connect a server"
 * or "ask your admin". These lock the two distinct reasons and the fact that
 * the tiles stay clickable.
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      warning: hooks.warning,
      info: hooks.info,
      error: hooks.error,
      success: hooks.success,
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, opts?: { defaultValue?: string; method?: string }) =>
      (opts?.defaultValue ?? _k).replace('{{method}}', opts?.method ?? ''),
  }),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  getLocalBaseUrl: () => 'http://127.0.0.1:13400',
  isBackendHttpError: (e: unknown) => Boolean(e && typeof e === 'object' && 'code' in e),
}));

vi.mock('@renderer/utils/enterprise/enterpriseBrowserLogin', () => ({
  openEnterpriseOAuthInBrowser: vi.fn().mockResolvedValue(true),
  openEnterprisePasswordLoginInBrowser: vi.fn().mockResolvedValue(true),
}));

const EnterpriseLoginChannelPanel = (await import('@renderer/pages/enterprise/components/EnterpriseLoginChannelPanel'))
  .default;

const mockProviders = (rows: unknown[]) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: rows }) } as unknown as Response)
  );
};

describe('EnterpriseLoginChannelPanel unavailable reasons', () => {
  it('opens the project invitation form without starting an SSO login', async () => {
    mockProviders([]);
    render(
      <EnterpriseLoginChannelPanel
        remoteOrigin='http://10.0.0.5:25808'
        projectInviteForm={<div data-testid='invitation-form'>Invitation form</div>}
      />
    );
    const entry = await screen.findByRole('button', { name: '项目组邀请码' });
    expect(entry).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(entry);
    expect(entry).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('invitation-form')).toBeVisible();
    fireEvent.click(entry);
    expect(screen.queryByTestId('invitation-form')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    hooks.warning.mockReset();
    hooks.info.mockReset();
  });

  it('explains that no enterprise server is connected, rather than showing dead tiles', async () => {
    mockProviders([]);
    render(<EnterpriseLoginChannelPanel />);

    expect(await screen.findByText(/尚未连接，因此下方仅「本地账户」可用/)).toBeInTheDocument();

    // The tile is still clickable — that click is the only way the reason
    // reaches a user who didn't read the panel text.
    const feishu = screen.getByText('飞书账号').closest('button') as HTMLButtonElement;
    expect(feishu.disabled).toBe(false);
    fireEvent.click(feishu);
    await waitFor(() => expect(hooks.warning).toHaveBeenCalled());
    expect(String(hooks.warning.mock.calls[0][0])).toContain('尚未连接企业服务器');
  });

  it('distinguishes "connected but the admin configured nothing" from "not connected"', async () => {
    mockProviders([{ provider: 'feishu', enabled: false, configured: false }]);
    render(<EnterpriseLoginChannelPanel remoteOrigin='http://10.0.0.5:25808' />);

    expect(await screen.findByText(/管理员尚未在企业管理后台启用任何 SSO 登录方式/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('飞书账号').closest('button') as HTMLButtonElement);
    await waitFor(() => expect(hooks.warning).toHaveBeenCalled());
    expect(String(hooks.warning.mock.calls[0][0])).toContain('尚未开通');
  });

  it('shows no reason banner once a channel is actually usable', async () => {
    mockProviders([{ provider: 'feishu', enabled: true, configured: true }]);
    render(<EnterpriseLoginChannelPanel remoteOrigin='http://10.0.0.5:25808' />);

    await waitFor(() => expect(screen.getByText('飞书账号')).toBeInTheDocument());
    expect(screen.queryByText(/尚未连接/)).toBeNull();
    expect(screen.queryByText(/管理员尚未/)).toBeNull();
  });

  it('places the usable local login before unconfigured enterprise methods', async () => {
    mockProviders([]);
    render(<EnterpriseLoginChannelPanel remoteOrigin='http://10.0.0.5:25808' />);
    await screen.findByText(/管理员尚未/);
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('本地账户');
  });

  it('prioritizes a configured SSO method while keeping local login available', async () => {
    mockProviders([{ provider: 'ldap', enabled: true, configured: true }]);
    render(<EnterpriseLoginChannelPanel remoteOrigin='http://10.0.0.5:25808' />);
    await waitFor(() => expect(screen.getAllByRole('button')[0]).toHaveTextContent('LDAP 域控'));
    expect(screen.getAllByRole('button')[1]).toHaveTextContent('本地账户');
  });
});

const inviteApi = vi.hoisted(() => ({ join: vi.fn(), context: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: { oneOrg: { join: { invoke: inviteApi.join }, context: { invoke: inviteApi.context } } },
}));
vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({ serverUrl: 'http://10.0.0.5:25808', serverUrlHistory: [] }),
  persistDeploymentServerUrl: vi.fn(),
}));
vi.mock('@/renderer/pages/enterprise/hooks/useOrgContext', () => ({
  ORG_CONTEXT_CHANGED_EVENT: 'one-org-context-changed',
  useOrgContext: () => ({ context: { isEnterprise: true, tenantId: 'enterprise', tenantName: 'Demo company' } }),
}));
vi.mock('@renderer/utils/enterprise/probeEnterpriseServer', () => ({
  probeRemoteEnterpriseServer: async () => 'ok',
  resolveEnterpriseServer: vi.fn(),
}));
vi.mock('@renderer/pages/settings/components/EnterpriseServerCard', () => ({
  describeConnectFailure: vi.fn(),
  readLocalClientInfo: vi.fn(),
}));
const EnterpriseLoginPage = (await import('@/renderer/pages/enterprise/EnterpriseLoginPage')).default;
const { openEnterprisePasswordLoginInBrowser } = await import('@renderer/utils/enterprise/enterpriseBrowserLogin');

describe('project invitation onboarding', () => {
  it('keeps the bright invitation action usable and explains an empty code without opening login', async () => {
    render(
      <MemoryRouter>
        <EnterpriseLoginPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: '项目组邀请码' }));
    const button = screen.getByRole('button', { name: 'common.enterprise.projectInviteSignIn' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(hooks.warning).toHaveBeenCalledWith('请输入邀请码');
    expect(openEnterprisePasswordLoginInBrowser).not.toHaveBeenCalled();
    expect(inviteApi.join).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('one-enterprise:enabled', 'true');
    localStorage.setItem('one-enterprise:server-url', 'http://10.0.0.5:25808');
    mockProviders([]);
  });
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('retains an invitation through account login, including an account already in the default company space', async () => {
    sessionStorage.setItem('onework:project-invite:http://10.0.0.5:25808', 'qa-invitation');
    const first = render(
      <MemoryRouter>
        <EnterpriseLoginPage />
      </MemoryRouter>
    );
    fireEvent.click(await screen.findByRole('button', { name: '项目组邀请码' }));
    expect(screen.getByDisplayValue('qa-invitation')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.enterprise.projectInviteSignIn' }));
    await waitFor(() =>
      expect(openEnterprisePasswordLoginInBrowser).toHaveBeenCalledWith('/enterprise/login', {
        remoteOrigin: 'http://10.0.0.5:25808',
      })
    );
    expect(inviteApi.join).not.toHaveBeenCalled();
    first.unmount();
    localStorage.setItem(
      'one-enterprise:session',
      JSON.stringify({ token: 'unit-test-token', userId: 'u', username: 'guest' })
    );
    render(
      <MemoryRouter>
        <EnterpriseLoginPage />
      </MemoryRouter>
    );
    expect(screen.getByDisplayValue('qa-invitation')).toBeInTheDocument();
    expect(screen.queryByText('已加入项目组')).not.toBeInTheDocument();
  });

  it('does not report invalid invitations as successful because the user belongs to another group', async () => {
    localStorage.setItem(
      'one-enterprise:session',
      JSON.stringify({ token: 'unit-test-token', userId: 'u', username: 'guest' })
    );
    sessionStorage.setItem('onework:project-invite:http://10.0.0.5:25808', 'invalid-code');
    inviteApi.join.mockRejectedValue({ code: 'INVALID_CODE', backendMessage: 'Expired invitation' });
    inviteApi.context.mockResolvedValue({ isEnterprise: true, tenantId: 'enterprise' });
    render(
      <MemoryRouter>
        <EnterpriseLoginPage />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: '加入' }));
    await waitFor(() => expect(hooks.error).toHaveBeenCalled());
    expect(hooks.info).not.toHaveBeenCalled();
    expect(hooks.success).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('invalid-code')).toBeInTheDocument();
  });
});
