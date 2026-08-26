/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
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
  shell: { openExternal: { invoke: vi.fn(() => Promise.resolve()) } },
  webui: {
    getStatus: { invoke: () => getStatusMock() },
    start: { invoke: vi.fn() },
    stop: { invoke: vi.fn() },
    statusChanged: { on: () => () => {} },
    changePassword: { invoke: vi.fn() },
    changeUsername: { invoke: vi.fn() },
    generateQRToken: { invoke: vi.fn() },
  },
}));

import WebuiModalContent from '@/renderer/components/settings/SettingsModal/contents/WebuiModalContent';

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

  it('shows the local WebUI login credentials while the server is running', async () => {
    getStatusMock.mockResolvedValue({ ...baseStatus, running: true });

    render(<WebuiModalContent />);

    await waitFor(() => {
      expect(screen.getByText('settings.webui.loginInfo')).toBeInTheDocument();
    });
    expect(screen.getByText('admin')).toBeInTheDocument();
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
