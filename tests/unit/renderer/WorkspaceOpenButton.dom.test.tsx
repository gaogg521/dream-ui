/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WorkspaceOpenButton from '@/renderer/pages/conversation/components/ChatLayout/WorkspaceOpenButton';

const checkToolInstalled = vi.fn();
const openFolderWith = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: {
      checkToolInstalled: { invoke: (...args: unknown[]) => checkToolInstalled(...args) },
      openFolderWith: { invoke: (...args: unknown[]) => openFolderWith(...args) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@icon-park/react', () => {
  const Icon = () => <span aria-hidden='true' />;
  return { Browser: Icon, Command: Icon, Down: Icon, FolderOpen: Icon, Terminal: Icon };
});

const STORAGE_KEY = 'workspace-open-preference';

const clickPrimaryButton = (container: HTMLElement): void => {
  const button = container.querySelector('.workspace-open-button__btn');
  if (!button) throw new Error('primary open button not found');
  fireEvent.click(button);
};

describe('WorkspaceOpenButton', () => {
  beforeEach(() => {
    localStorage.clear();
    checkToolInstalled.mockReset();
    openFolderWith.mockReset();
    openFolderWith.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the file explorer on first click even when VS Code is installed and no preference was ever chosen', async () => {
    // Regression test: `availableOptions[0]` used to be the fallback default,
    // and VS Code is listed before Terminal/Explorer in `toolOptions` — so on
    // any machine with VS Code installed, the very first click silently
    // launched a code editor instead of the file manager the button's
    // tooltip ("Open workspace folder") promises.
    checkToolInstalled.mockResolvedValue(true);
    const { container } = render(<WorkspaceOpenButton workspacePath='/tmp/project' isTemporary={false} />);

    await waitFor(() => expect(checkToolInstalled).toHaveBeenCalledWith({ tool: 'vscode' }));

    clickPrimaryButton(container);

    await waitFor(() => expect(openFolderWith).toHaveBeenCalledTimes(1));
    expect(openFolderWith).toHaveBeenCalledWith({ folder_path: '/tmp/project', tool: 'explorer' });
  });

  it('respects a previously saved tool preference', async () => {
    checkToolInstalled.mockResolvedValue(true);
    localStorage.setItem(STORAGE_KEY, 'vscode');
    const { container } = render(<WorkspaceOpenButton workspacePath='/tmp/project' isTemporary={false} />);

    await waitFor(() => expect(checkToolInstalled).toHaveBeenCalled());

    clickPrimaryButton(container);

    await waitFor(() => expect(openFolderWith).toHaveBeenCalledTimes(1));
    expect(openFolderWith).toHaveBeenCalledWith({ folder_path: '/tmp/project', tool: 'vscode' });
  });

  it('does not persist a new preference when opening the folder fails', async () => {
    checkToolInstalled.mockResolvedValue(false);
    openFolderWith.mockRejectedValueOnce(new Error('boom'));
    const { container } = render(<WorkspaceOpenButton workspacePath='/tmp/project' isTemporary={false} />);

    await waitFor(() => expect(checkToolInstalled).toHaveBeenCalled());

    clickPrimaryButton(container);

    await waitFor(() => expect(openFolderWith).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
