/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * Page composition, not component behaviour: "type the server address",
 * "connect" and "log in against it" are three halves of one task that used to
 * live on two different settings pages, so filling in an address left the
 * user with no visible next step. This locks them onto one page, in that
 * order.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k }),
}));

vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => true }));

vi.mock('@renderer/hooks/enterprise/useDeploymentRole', () => ({
  useDeploymentRole: () => ({
    loading: false,
    role: 'client',
    serverUrl: '',
    normalizedServerUrl: null,
    serverUrlHistory: [],
    isClient: true,
    refresh: vi.fn(),
  }),
  persistDeploymentServerUrl: vi.fn(),
  clearDeploymentServerUrlHistory: vi.fn(),
}));

vi.mock('@renderer/pages/settings/components/EnterpriseServerCard', () => ({
  default: () => <div data-testid='server-card'>企业服务器</div>,
}));
vi.mock('@/renderer/pages/enterprise/components/RemoteServerSection', () => ({
  default: () => <div data-testid='remote-server-section'>连接远端企业服务器</div>,
}));
vi.mock('@/renderer/pages/enterprise/components/EnterpriseIdentityCard', () => ({
  default: () => <div data-testid='identity-card'>企业身份信息</div>,
}));
vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const EnterpriseIdentitySettings = (await import('@renderer/pages/settings/EnterpriseIdentitySettings')).default;

describe('EnterpriseIdentitySettings composition', () => {
  afterEach(() => {
    localStorage.removeItem('one-enterprise:enabled');
    localStorage.removeItem('one-enterprise:session');
  });

  it('shows only the connect card before a server is connected', async () => {
    render(<EnterpriseIdentitySettings />);

    await waitFor(() => expect(screen.getByTestId('server-card')).toBeInTheDocument());
    // Login and identity have nothing to act on yet; they used to render as a
    // stack of "未启用" / "暂无企业身份" cards that read as broken.
    expect(screen.queryByTestId('remote-server-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('identity-card')).not.toBeInTheDocument();
  });

  it('adds the login section once connected, and identity once signed in', async () => {
    localStorage.setItem('one-enterprise:enabled', 'true');
    const { unmount } = render(<EnterpriseIdentitySettings />);

    await waitFor(() => expect(screen.getByTestId('server-card')).toBeInTheDocument());
    expect(screen.getByTestId('remote-server-section')).toBeInTheDocument();
    // Connected but not signed in: the identity card would only say
    // "无法获取企业身份信息".
    expect(screen.queryByTestId('identity-card')).not.toBeInTheDocument();
    unmount();

    localStorage.setItem('one-enterprise:session', JSON.stringify({ token: 't', username: 'u' }));
    render(<EnterpriseIdentitySettings />);
    await waitFor(() => expect(screen.getByTestId('identity-card')).toBeInTheDocument());

    // Order matters: pick a server before being asked to log into one.
    const card = screen.getByTestId('server-card');
    const login = screen.getByTestId('remote-server-section');
    expect(card.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
