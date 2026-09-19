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
  showItemInFolderMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: mocks.httpRequestMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { showItemInFolder: { invoke: mocks.showItemInFolderMock } },
  },
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
   * Fills in the passphrase dialog and confirms it.
   *
   * Every export goes through this now: the archive is encrypted, so the POST
   * does not happen until a passphrase exists. Driving the real dialog rather
   * than reaching past it is the point — the flow a person walks is export ->
   * pick a file -> set a passphrase, and a test that skipped the middle step
   * would keep passing if the dialog stopped appearing entirely.
   */
  const enterPassphrase = async (passphrase: string, { confirm = true } = {}) => {
    const field = await screen.findByPlaceholderText('settings.backup.passphrasePlaceholder');
    fireEvent.change(field, { target: { value: passphrase } });
    if (confirm) {
      const again = screen.getByPlaceholderText('settings.backup.passphraseConfirmPlaceholder');
      fireEvent.change(again, { target: { value: passphrase } });
    }
    // The dialog's own confirm button, not the section's export button.
    const ok = document.querySelector('.arco-modal-footer .arco-btn-primary');
    expect(ok).not.toBeNull();
    fireEvent.click(ok as Element);
  };

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
    // Clear one of the defaulted-on categories so the request is not the
    // trivial everything-on case.
    fireEvent.click(screen.getByText('settings.backup.scope.skills'));
    fireEvent.click(screen.getByText('settings.backup.exportButton'));
    await enterPassphrase('correct-horse-battery');

    await waitFor(() => expect(mocks.httpRequestMock).toHaveBeenCalled());
    const [method, path, body] = mocks.httpRequestMock.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('/api/system/backup');
    expect(body).toEqual({
      destination: 'D:/backups/mine.zip',
      scope: { conversations: true, attachments: false, providers: true, skills: false, appSettings: true },
      passphrase: 'correct-horse-battery',
    });
  });

  /**
   * Attachments default off because they are the one category that can run for
   * half an hour — measured at 13,304 files / 228 MB on a developer install,
   * while everything else finishes in seconds. On by default, the ordinary
   * backup looked like the app had hung.
   */
  it('leaves workspace attachments out by default', async () => {
    mocks.showSaveMock.mockResolvedValue('D:/backups/mine.zip');
    mocks.httpRequestMock.mockResolvedValue({ path: 'x', archiveBytes: 1, manifest: {} });

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.exportButton'));
    await enterPassphrase('correct-horse-battery');

    await waitFor(() => expect(mocks.httpRequestMock).toHaveBeenCalled());
    expect(mocks.httpRequestMock.mock.calls[0][2].scope.attachments).toBe(false);
  });

  /**
   * The user picked the destination minutes earlier in a native dialog; making
   * them go find it afterwards is how a finished backup still feels lost.
   */
  it('offers to reveal the archive only after one has been written', async () => {
    mocks.showSaveMock.mockResolvedValue('D:/backups/mine.zip');
    mocks.httpRequestMock.mockResolvedValue({ path: 'D:/backups/mine.zip', archiveBytes: 2048, manifest: {} });

    render(<BackupSection />);
    expect(screen.queryByText('settings.backup.revealButton')).toBeNull();

    fireEvent.click(screen.getByText('settings.backup.exportButton'));
    await enterPassphrase('correct-horse-battery');
    await waitFor(() => expect(screen.queryByText('settings.backup.revealButton')).not.toBeNull());
    // The path is shown too, so it is findable even without the button.
    expect(screen.queryByText('D:/backups/mine.zip')).not.toBeNull();

    fireEvent.click(screen.getByText('settings.backup.revealButton'));
    expect(mocks.showItemInFolderMock).toHaveBeenCalledWith('D:/backups/mine.zip');
  });

  it('warns about the wait only while attachments are selected', () => {
    render(<BackupSection />);
    expect(screen.queryByText('settings.backup.attachmentsSlowWarning')).toBeNull();

    fireEvent.click(screen.getByText('settings.backup.scope.attachments'));
    expect(screen.queryByText('settings.backup.attachmentsSlowWarning')).not.toBeNull();
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
    // Attachments start off, so clearing the four that start on empties the
    // selection.
    for (const key of ['conversations', 'providers', 'skills', 'appSettings']) {
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
      // A version 2 archive has no encryption header, so it is restored
      // without asking for something that cannot exist.
      passphrase: '',
    });
  });

  /**
   * An encrypted archive cannot be opened without the passphrase, so the
   * restore waits for one instead of sending a request that would be refused.
   */
  it('asks for the passphrase before restoring an encrypted archive', async () => {
    mocks.showOpenMock.mockResolvedValue(['D:/backups/sealed.zip']);
    const archiveScope = {
      conversations: true,
      attachments: false,
      providers: true,
      skills: false,
      appSettings: false,
    };
    mocks.httpRequestMock.mockResolvedValue({
      formatVersion: 3,
      exportedAt: 1_700_000_000_000,
      appVersion: '3.0.6',
      scope: archiveScope,
      totalBytes: 1024,
      containsCredentials: true,
      encryption: { cipher: 'aes-256-gcm', kdf: 'argon2id' },
    });

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.importButton'));
    await waitFor(() => expect(mocks.modalConfirmMock).toHaveBeenCalled());

    // Confirming the merge does NOT restore yet — it opens the passphrase
    // dialog. Only the preview has gone out so far.
    await mocks.modalConfirmMock.mock.calls[0][0].onOk();
    expect(mocks.httpRequestMock).toHaveBeenCalledTimes(1);

    mocks.httpRequestMock.mockResolvedValue({ rowsByTable: { conversations: 3 }, filesRestored: 0 });
    await enterPassphrase('correct-horse-battery', { confirm: false });

    await waitFor(() =>
      expect(mocks.httpRequestMock).toHaveBeenLastCalledWith('POST', '/api/system/backup/restore', {
        source: 'D:/backups/sealed.zip',
        scope: archiveScope,
        passphrase: 'correct-horse-battery',
      })
    );
  });

  /**
   * The archive is written only once a passphrase exists. Abandoning the dialog
   * must leave nothing behind — least of all a file the person believes is
   * protected.
   */
  it('writes nothing when the passphrase dialog is cancelled', async () => {
    mocks.showSaveMock.mockResolvedValue('D:/backups/mine.zip');

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.exportButton'));
    await screen.findByPlaceholderText('settings.backup.passphrasePlaceholder');

    const cancel = document.querySelector('.arco-modal-footer .arco-btn-secondary');
    expect(cancel).not.toBeNull();
    fireEvent.click(cancel as Element);

    expect(mocks.httpRequestMock).not.toHaveBeenCalled();
  });

  /**
   * A passphrase nobody can recover has to be typed twice, and a mismatch must
   * not be exportable — the archive would be unopenable and the person would
   * find out on the day they needed it.
   */
  it('refuses to export until both passphrase fields agree', async () => {
    mocks.showSaveMock.mockResolvedValue('D:/backups/mine.zip');

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.exportButton'));

    const field = await screen.findByPlaceholderText('settings.backup.passphrasePlaceholder');
    fireEvent.change(field, { target: { value: 'correct-horse-battery' } });
    const again = screen.getByPlaceholderText('settings.backup.passphraseConfirmPlaceholder');
    fireEvent.change(again, { target: { value: 'something-else-entirely' } });

    const ok = document.querySelector('.arco-modal-footer .arco-btn-primary') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.click(ok);
    expect(mocks.httpRequestMock).not.toHaveBeenCalled();
  });

  /**
   * The eight-character floor is the one rule in this dialog that the UI states
   * out loud and that nothing was checking. It matters more than it looks: the
   * passphrase is unrecoverable, so a short one is not a weak password the user
   * can rotate later -- it is the only thing standing between an archive full
   * of API keys and whoever picks the file up.
   *
   * Seven characters, matching in both fields, so the only thing that can
   * refuse this is the length rule itself.
   */
  it('refuses to export a passphrase shorter than the stated minimum', async () => {
    mocks.showSaveMock.mockResolvedValue('D:/backups/mine.zip');

    render(<BackupSection />);
    fireEvent.click(screen.getByText('settings.backup.exportButton'));

    const field = await screen.findByPlaceholderText('settings.backup.passphrasePlaceholder');
    fireEvent.change(field, { target: { value: 'sevench' } });
    const again = screen.getByPlaceholderText('settings.backup.passphraseConfirmPlaceholder');
    fireEvent.change(again, { target: { value: 'sevench' } });

    const ok = document.querySelector('.arco-modal-footer .arco-btn-primary') as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.click(ok);
    expect(mocks.httpRequestMock).not.toHaveBeenCalled();

    // One more character is the whole difference: this proves the refusal was
    // the length rule and not some unrelated invalid state.
    fireEvent.change(field, { target: { value: 'eightchr' } });
    fireEvent.change(again, { target: { value: 'eightchr' } });
    const okNow = document.querySelector('.arco-modal-footer .arco-btn-primary') as HTMLButtonElement;
    expect(okNow.disabled).toBe(false);
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
