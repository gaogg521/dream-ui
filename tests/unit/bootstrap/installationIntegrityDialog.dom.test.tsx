import React from 'react';
/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The installation-integrity dialog is shared by two paths with opposite
 * premises, and the difference is not cosmetic:
 *
 *   - backend startup failed  -> nothing works, the modal is the whole app
 *   - a runtime component failed -> the app is running fine; only one backend
 *     is unavailable, so trapping the user turns a partial outage into a total
 *     one
 *
 * Startup failure must offer native quit without dismissing to a blank screen.
 * Runtime failures can dismiss and continue using the rest of the application.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Message } from '@arco-design/web-react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/services/feedback/submitFeedbackReport', () => ({
  submitFeedbackReport: vi.fn().mockResolvedValue(undefined),
}));

import {
  openDownloadLatest,
  showInstallationIntegrityModal,
} from '@/renderer/components/layout/InstallationIntegrityDialog';

type CapturedModalConfig = {
  closable?: boolean;
  maskClosable?: boolean;
  escToExit?: boolean;
  footer?: React.ReactNode;
  title?: React.ReactNode;
};

const t = ((key: string) => key) as unknown as Parameters<typeof showInstallationIntegrityModal>[1];

/**
 * Stands in for Arco's `Modal.useModal()` controller so the config handed to
 * `modal.error` can be inspected directly, and so `close()` is observable.
 */
function stubModalController() {
  const close = vi.fn();
  let captured: CapturedModalConfig | undefined;
  const controller = {
    error: (config: CapturedModalConfig) => {
      captured = config;
      return { close, update: vi.fn() };
    },
  } as unknown as Parameters<typeof showInstallationIntegrityModal>[0];

  return { controller, close, config: () => captured };
}

afterEach(() => {
  cleanup();
  delete window.electronAPI;
});

describe('backend-independent recovery download', () => {
  afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
  });
  it('uses native shell IPC instead of opening an Electron child window', async () => {
    const nativeOpen = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = { emit: vi.fn(), on: vi.fn(), openDownloadLatest: nativeOpen };
    const browserOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    openDownloadLatest();
    expect(nativeOpen).toHaveBeenCalledOnce();
    expect(browserOpen).not.toHaveBeenCalled();
  });
  it('reports a native browser launch failure instead of silently doing nothing', async () => {
    window.electronAPI = {
      emit: vi.fn(),
      on: vi.fn(),
      openDownloadLatest: vi.fn().mockRejectedValue(new Error('no browser')),
    };
    const showError = vi.spyOn(Message, 'error').mockReturnValue({} as ReturnType<typeof Message.error>);
    openDownloadLatest();
    await waitFor(() => expect(showError).toHaveBeenCalled());
  });
  it('retains normal browser navigation in WebUI', () => {
    delete window.electronAPI;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openDownloadLatest();
    expect(open).toHaveBeenCalledWith('https://work.1oneclaw.com/', '_blank', 'noopener,noreferrer');
  });
});

describe('showInstallationIntegrityModal', () => {
  it('offers native quit on startup failure without dismissing to a blank screen', async () => {
    const quit = vi.fn();
    window.electronAPI = { emit: vi.fn(), on: vi.fn(), quitFromRecovery: quit };
    const { controller, config } = stubModalController();

    showInstallationIntegrityModal(controller, t, 'backend is dead');

    expect(config()?.closable).toBe(false);
    expect(config()?.maskClosable).toBe(false);
    expect(config()?.escToExit).toBe(false);

    render(<ConfigProvider>{config()?.footer}</ConfigProvider>);
    expect(screen.queryByTestId('installation-integrity-dismiss')).toBeNull();
    await userEvent.click(screen.getByTestId('installation-integrity-quit'));
    expect(quit).toHaveBeenCalledOnce();
  });

  it('gives the runtime-component dialog a visible way out', () => {
    window.electronAPI = { emit: vi.fn(), on: vi.fn(), quitFromRecovery: vi.fn() };
    const { controller, config } = stubModalController();

    showInstallationIntegrityModal(controller, t, 'claude acp is missing', undefined, 'incomplete_installation', {
      dismissible: true,
    });

    expect(config()?.closable).toBe(true);

    render(<ConfigProvider>{config()?.footer}</ConfigProvider>);
    expect(screen.getByTestId('installation-integrity-dismiss')).toBeInTheDocument();
    expect(screen.queryByTestId('installation-integrity-quit')).toBeNull();
  });

  it('actually closes the dialog when that way out is used', async () => {
    const { controller, close, config } = stubModalController();

    showInstallationIntegrityModal(controller, t, 'claude acp is missing', undefined, 'incomplete_installation', {
      dismissible: true,
    });

    render(<ConfigProvider>{config()?.footer}</ConfigProvider>);
    await userEvent.click(screen.getByTestId('installation-integrity-dismiss'));

    expect(close).toHaveBeenCalledTimes(1);
  });

  /**
   * The mask stays locked even when dismissible: a stray click outside should
   * not silently drop a message about a broken install.
   */
  it('never lets a click on the backdrop dismiss it', () => {
    const { controller, config } = stubModalController();

    showInstallationIntegrityModal(controller, t, 'claude acp is missing', undefined, 'incomplete_installation', {
      dismissible: true,
    });

    expect(config()?.maskClosable).toBe(false);
  });

  it('keeps the diagnostics and download actions available alongside the way out', () => {
    const { controller, config } = stubModalController();

    showInstallationIntegrityModal(
      controller,
      t,
      'claude acp is missing',
      { source: 'runtime_status', description: 'claude acp is missing' },
      'incomplete_installation',
      { dismissible: true }
    );

    render(<ConfigProvider>{config()?.footer}</ConfigProvider>);
    expect(screen.getByTestId('installation-integrity-dismiss')).toBeInTheDocument();
    expect(screen.getByTestId('installation-integrity-report')).toBeInTheDocument();
    expect(screen.getByTestId('installation-integrity-download')).toBeInTheDocument();
  });
});
