/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  showSaveMock: vi.fn(),
  showOpenMock: vi.fn(),
  isNativeDialogAvailableMock: vi.fn(() => true),
  messageSuccessMock: vi.fn(),
  messageErrorMock: vi.fn(),
  modalConfirmMock: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: mocks.httpRequestMock,
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  dialog: {
    showSave: { invoke: mocks.showSaveMock },
    showOpen: { invoke: mocks.showOpenMock },
  },
  isNativeDialogAvailable: mocks.isNativeDialogAvailableMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, success: mocks.messageSuccessMock, error: mocks.messageErrorMock },
    Modal: { ...actual.Modal, confirm: mocks.modalConfirmMock },
  };
});

import BackupSection from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/BackupSection';

describe('BackupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isNativeDialogAvailableMock.mockReturnValue(true);
  });

  afterEach(cleanup);

  /**
   * A backup names a path on the machine running the backend. In WebUI that is
   * a server the user cannot browse, so offering the picker would write the
   * archive somewhere they can never retrieve it.
   */
  it('renders nothing when native dialogs are unavailable', () => {
    mocks.isNativeDialogAvailableMock.mockReturnValue(false);
    const { container } = render(<BackupSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sends the selected categories to the export endpoint', async () => {
    mocks.showSaveMock.mockResolvedValue('D:/backups/mine.zip');
    mocks.httpRequestMock.mockResolvedValue({ path: 'D:/backups/mine.zip', archiveBytes: 2048, manifest: {} });

    render(<BackupSection />);
    // Everything is selected by default — clear one so the request is not the
    // trivial all-true case.
    fireEvent.click(screen.getByText('settings.backup.scope.attachments'));
    fireEvent.click(screen.getByText('settings.backup.exportButton'));

    await waitFor(() => expect(mocks.httpRequestMock).toHaveBeenCalled());
    const [method, path, body] = mocks.httpRequestMock.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/system/backup');
    expect(body).toEqual({
      destination: 'D:/backups/mine.zip',
      scope: { conversations: true, attachments: false, providers: true, skills: true, appSettings: true },
    });
  });

  it('does not call the backend when the save dialog is cancelled', async () => {
    mocks.showSaveMock.mockResolvedValue(undefined);

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.exportButton'));

    await waitFor(() => expect(mocks.showSaveMock).toHaveBeenCalled());
    expect(mocks.httpRequestMock).not.toHaveBeenCalled();
  });

  /**
   * An archive carrying provider configuration contains decryptable API keys.
   * The user has to be told before they put that file somewhere.
   */
  it('warns about credentials only while model configuration is selected', () => {
    render(<BackupSection />);
    expect(screen.queryByText('settings.backup.credentialWarning')).not.toBeNull();

    fireEvent.click(screen.getByText('settings.backup.scope.providers'));
    expect(screen.queryByText('settings.backup.credentialWarning')).toBeNull();
  });

  it('disables export when nothing is selected', () => {
    render(<BackupSection />);
    for (const key of ['conversations', 'attachments', 'providers', 'skills', 'appSettings']) {
      fireEvent.click(screen.getByText(`settings.backup.scope.${key}`));
    }

    const button = screen.getByText('settings.backup.exportButton').closest('button');
    expect(button?.disabled).toBe(true);
  });

  /**
   * The restore must ask before merging, and must scope the merge to what the
   * archive actually carries rather than to whatever is ticked in the form.
   */
  it('previews an archive and confirms before restoring', async () => {
    mocks.showOpenMock.mockResolvedValue(['D:/backups/mine.zip']);
    const archiveScope = {
      conversations: true,
      attachments: false,
      providers: false,
      skills: false,
      appSettings: false,
    };
    mocks.httpRequestMock.mockResolvedValue({
      formatVersion: 2,
      exportedAt: 1_700_000_000_000,
      appVersion: '3.0.5',
      scope: archiveScope,
      totalBytes: 1024,
      containsCredentials: false,
    });

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.importButton'));

    await waitFor(() => expect(mocks.modalConfirmMock).toHaveBeenCalled());
    expect(mocks.httpRequestMock).toHaveBeenCalledWith('POST', '/api/system/backup/preview', {
      source: 'D:/backups/mine.zip',
    });

    // Nothing is applied until the confirm dialog's onOk runs.
    expect(mocks.httpRequestMock).toHaveBeenCalledTimes(1);

    mocks.httpRequestMock.mockResolvedValue({ rowsByTable: { conversations: 3 }, filesRestored: 2 });
    await mocks.modalConfirmMock.mock.calls[0][0].onOk();

    expect(mocks.httpRequestMock).toHaveBeenLastCalledWith('POST', '/api/system/backup/restore', {
      source: 'D:/backups/mine.zip',
      scope: archiveScope,
    });
  });

  it('reports a preview failure without opening the confirm dialog', async () => {
    mocks.showOpenMock.mockResolvedValue(['D:/backups/broken.zip']);
    mocks.httpRequestMock.mockRejectedValue(new Error('This file is not a One Work backup.'));

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.importButton'));

    await waitFor(() => expect(mocks.messageErrorMock).toHaveBeenCalledWith('This file is not a One Work backup.'));
    expect(mocks.modalConfirmMock).not.toHaveBeenCalled();
  });
});
