/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { IWebUIStatus } from '@/common/adapter/ipcBridge';

const getStatusMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@/renderer/components/base/DreamScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/DreamModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div>{children}</div> : null,
}));

vi.mock('@/renderer/hooks/assistant/useTalkToButler', () => ({
  useTalkToButler: () => vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  isBackendHttpError: () => false,
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    // `whenReady` is awaited by useDeploymentRole, which this modal renders.
    // Leaving it out does NOT fail a test — the rejection lands after the file
    // finishes, so vitest reports "2 passed ... Errors 2 errors" and exits
    // non-zero. Read the Errors line, not just the passed count.
    whenReady: vi.fn(() => Promise.resolve()),
    get: vi.fn(() => false),
    set: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  channel: { getPushTargets: { invoke: vi.fn(() => Promise.resolve([])) } },
  shell: { openExternal: { invoke: vi.fn(() => Promise.resolve()) } },
  webui: {
    getStatus: { invoke: () => getStatusMock() },
    start: { invoke: vi.fn() },
    stop: { invoke: vi.fn() },
    statusChanged: { on: () => () => {} },
    tunnelChanged: { on: () => () => {} },
    setTunnel: { invoke: vi.fn(() => Promise.resolve({ state: 'off' })) },
    resetTunnelAddress: { invoke: vi.fn(() => Promise.resolve({ state: 'off' })) },
    changePassword: { invoke: vi.fn() },
    changeUsername: { invoke: vi.fn() },
    generateQRToken: { invoke: vi.fn() },
  },
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/ChannelModalContent', () => ({
  default: () => <div data-testid='channel-configuration'>Channel configuration</div>,
}));

import WebuiModalContent from '@/renderer/components/settings/SettingsModal/contents/WebuiModalContent';
import WebuiSettings from '@/renderer/pages/settings/WebuiSettings';

const baseStatus: IWebUIStatus = {
  running: false,
  port: 25809,
  allowRemote: false,
  localUrl: 'http://localhost:25809',
  adminUsername: 'admin',
};

describe('WebuiModalContent login info card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the channel configuration tab from the automation setup link', async () => {
    getStatusMock.mockResolvedValue(baseStatus);
    render(
      <MemoryRouter initialEntries={['/settings/webui?tab=channels']}>
        <WebuiSettings />
      </MemoryRouter>
    );
    expect(await screen.findByTestId('channel-configuration')).toBeVisible();
  });

  it('follows a new requested tab when the existing settings view is reused', async () => {
    getStatusMock.mockResolvedValue(baseStatus);
    const view = render(<WebuiModalContent initialTab='channels' />);
    expect(await screen.findByTestId('channel-configuration')).toBeVisible();
    view.rerender(<WebuiModalContent initialTab='webui' />);
    expect(await screen.findByText('settings.webui.loginInfo')).toBeVisible();
  });

  it('shows the local WebUI login credentials while the server is running', async () => {
    getStatusMock.mockResolvedValue({ ...baseStatus, running: true });

    render(<WebuiModalContent />);

    await waitFor(() => {
      expect(screen.getByText('settings.webui.loginInfo')).toBeInTheDocument();
    });
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('lays the page out as an overview plus one card per topic', async () => {
    getStatusMock.mockResolvedValue({ ...baseStatus, running: false });
    render(<WebuiModalContent />);
    for (const id of [
      'webui-hero-card',
      'webui-service-card',
      'webui-lan-card',
      'webui-tunnel-card',
      'webui-turn-push-card',
      'webui-login-card',
    ]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
    // The temporary public link stays reachable even before anything is switched on.
    expect(screen.getByTestId('webui-butler-link')).toBeInTheDocument();
    // No QR code until there is an address a phone can reach; the overview says what to do instead.
    expect(screen.getByTestId('webui-hero-card')).toHaveTextContent('settings.webui.heroNoQr');
  });

  it('shows the state of each card at a glance', async () => {
    getStatusMock.mockResolvedValue({ ...baseStatus, running: true });
    render(<WebuiModalContent />);
    const service = await screen.findByTestId('webui-service-card');
    await waitFor(() => expect(service).toHaveTextContent('settings.webui.running'));
    // Nothing else is switched on yet, so those cards say so rather than staying silent.
    expect(screen.getByTestId('webui-lan-card')).toHaveTextContent('settings.webui.statusOff');
    expect(screen.getByTestId('webui-tunnel-card')).toHaveTextContent('settings.webui.statusOff');
    expect(screen.getByTestId('webui-turn-push-card')).toHaveTextContent('settings.webui.statusOff');
  });

  it('still shows the local WebUI login credentials when the server is stopped', async () => {
    // Regression guard: local WebUI credentials are independent of enterprise
    // deployment role and of whether the server happens to be running right
    // now — the card must not disappear based on either.
    getStatusMock.mockResolvedValue({ ...baseStatus, running: false });

    render(<WebuiModalContent />);

    await waitFor(() => {
      expect(screen.getByText('settings.webui.loginInfo')).toBeInTheDocument();
    });
    expect(screen.getByText('admin')).toBeInTheDocument();
  });
});
