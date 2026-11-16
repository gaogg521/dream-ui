import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import WebuiTunnelSection from '@/renderer/components/settings/SettingsModal/contents/webuiTunnel/WebuiTunnelSection';
import type { WebuiTunnelController } from '@/renderer/components/settings/SettingsModal/contents/webuiTunnel/useWebuiTunnel';

const makeTunnel = (overrides: Partial<WebuiTunnelController> = {}): WebuiTunnelController => ({
  status: { state: 'off', componentReady: true },
  enabled: false,
  busy: false,
  setEnabled: vi.fn(async () => true),
  resetAddress: vi.fn(async () => true),
  reachableUrl: undefined,
  ...overrides,
});

const toggle = (): HTMLElement => screen.getByRole('switch');

describe('WebuiTunnelSection component download consent', () => {
  it('switches on straight away when the component is already on this machine', async () => {
    const tunnel = makeTunnel({ status: { state: 'off', componentReady: true } });
    render(<WebuiTunnelSection tunnel={tunnel} webuiRunning />);

    fireEvent.click(toggle());

    await waitFor(() => expect(tunnel.setEnabled).toHaveBeenCalledWith(true, false));
    expect(screen.queryByText('settings.webui.tunnelInstallContent')).not.toBeInTheDocument();
  });

  it('asks first when the component is missing, and downloads only after the user agrees', async () => {
    const tunnel = makeTunnel({ status: { state: 'off', componentReady: false } });
    render(<WebuiTunnelSection tunnel={tunnel} webuiRunning />);

    fireEvent.click(toggle());

    expect(await screen.findByText('settings.webui.tunnelInstallContent')).toBeInTheDocument();
    expect(tunnel.setEnabled).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('settings.webui.tunnelInstallOk'));
    await waitFor(() => expect(tunnel.setEnabled).toHaveBeenCalledWith(true, true));
  });

  it('switching off never asks anything', async () => {
    const tunnel = makeTunnel({
      enabled: true,
      status: { state: 'connected', url: 'https://x.r.1work.vip', componentReady: true },
    });
    render(<WebuiTunnelSection tunnel={tunnel} webuiRunning />);

    fireEvent.click(toggle());

    await waitFor(() => expect(tunnel.setEnabled).toHaveBeenCalledWith(false));
  });

  it('shows a progress status while the component is being downloaded', () => {
    const tunnel = makeTunnel({ enabled: true, status: { state: 'installing', componentReady: false } });
    render(<WebuiTunnelSection tunnel={tunnel} webuiRunning />);

    expect(screen.getByTestId('webui-tunnel-card')).toHaveTextContent('settings.webui.tunnelInstalling');
  });

  it.each([
    ['download_failed', 'settings.webui.tunnelError.download_failed'],
    ['blocked', 'settings.webui.tunnelError.blocked'],
  ] as const)('offers a retry that reuses the consent after %s', async (error, message) => {
    const tunnel = makeTunnel({ enabled: true, status: { state: 'error', error, componentReady: false } });
    render(<WebuiTunnelSection tunnel={tunnel} webuiRunning />);

    expect(screen.getByTestId('webui-tunnel-card')).toHaveTextContent(message);
    fireEvent.click(screen.getByText('settings.webui.tunnelInstallRetry'));

    await waitFor(() => expect(tunnel.setEnabled).toHaveBeenCalledWith(true, true));
  });

  it('an app that was already switched on before the component was removed gets asked, not silently downloaded', async () => {
    const tunnel = makeTunnel({
      enabled: true,
      status: { state: 'error', error: 'needs_install', componentReady: false },
    });
    render(<WebuiTunnelSection tunnel={tunnel} webuiRunning />);

    fireEvent.click(screen.getByText('settings.webui.tunnelInstallOk'));

    expect(await screen.findByText('settings.webui.tunnelInstallContent')).toBeInTheDocument();
    expect(tunnel.setEnabled).not.toHaveBeenCalled();
  });
});
