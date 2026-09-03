/**
 * @license
 * Copyright 2026 1ONE
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
import { describe, expect, it, vi } from 'vitest';

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
    isServer: false,
    refresh: vi.fn(),
  }),
  persistDeploymentRole: vi.fn(),
  persistDeploymentServerUrl: vi.fn(),
  clearDeploymentServerUrlHistory: vi.fn(),
}));

vi.mock('@renderer/pages/settings/components/EnterpriseDeploymentModeCard', () => ({
  default: () => <div data-testid='deployment-card'>项目组部署模式</div>,
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
  it('carries the deployment card, and puts it before the login section', async () => {
    render(<EnterpriseIdentitySettings />);

    await waitFor(() => expect(screen.getByTestId('deployment-card')).toBeInTheDocument());
    expect(screen.getByTestId('remote-server-section')).toBeInTheDocument();
    expect(screen.getByTestId('identity-card')).toBeInTheDocument();

    // Order matters: pick a server before being asked to log into one.
    const card = screen.getByTestId('deployment-card');
    const login = screen.getByTestId('remote-server-section');
    expect(card.compareDocumentPosition(login) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
