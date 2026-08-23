import React from 'react';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
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
 * These tests pin that distinction. Esc always closed the dialog (Arco's
 * escToExit defaults to true), so what is asserted here is the presence of a
 * *visible* way out, which is what the user in the 2026-08-07 report lacked.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/services/feedback/submitFeedbackReport', () => ({
  submitFeedbackReport: vi.fn().mockResolvedValue(undefined),
}));

import { showInstallationIntegrityModal } from '@/renderer/components/layout/InstallationIntegrityDialog';

type CapturedModalConfig = {
  closable?: boolean;
  maskClosable?: boolean;
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

afterEach(cleanup);

describe('showInstallationIntegrityModal', () => {
  it('leaves the backend-startup dialog with no way out, because there is nothing behind it', () => {
    const { controller, config } = stubModalController();

    showInstallationIntegrityModal(controller, t, 'backend is dead');

    expect(config()?.closable).toBe(false);
    expect(config()?.maskClosable).toBe(false);

    render(<ConfigProvider>{config()?.footer}</ConfigProvider>);
    expect(screen.queryByTestId('installation-integrity-dismiss')).toBeNull();
  });

  it('gives the runtime-component dialog a visible way out', () => {
    const { controller, config } = stubModalController();

    showInstallationIntegrityModal(controller, t, 'claude acp is missing', undefined, 'incomplete_installation', {
      dismissible: true,
    });

    expect(config()?.closable).toBe(true);

    render(<ConfigProvider>{config()?.footer}</ConfigProvider>);
    expect(screen.getByTestId('installation-integrity-dismiss')).toBeInTheDocument();
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
