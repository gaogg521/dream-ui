/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * T8: the consolidated media ledger admin view. Covers the prompt-retention
 * toggle (off by default, saved through the settings endpoint) and that
 * assets render with their attribution fields.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  listMediaAssets: vi.fn(),
  getMediaLedgerSettings: vi.fn(),
  setMediaLedgerSettings: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneBilling: {
      listMediaAssets: { invoke: hooks.listMediaAssets },
      getMediaLedgerSettings: { invoke: hooks.getMediaLedgerSettings },
      setMediaLedgerSettings: { invoke: hooks.setMediaLedgerSettings },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}`,
  }),
}));

const MediaLedgerTab = (await import('@/renderer/pages/enterprise/components/MediaLedgerTab')).default;

beforeEach(() => {
  hooks.listMediaAssets.mockReset().mockResolvedValue([]);
  hooks.getMediaLedgerSettings.mockReset().mockResolvedValue({ retainPrompts: false });
  hooks.setMediaLedgerSettings.mockReset();
});

describe('MediaLedgerTab', () => {
  it('lists assets and shows "not retained" instead of a prompt when the company has not opted in', async () => {
    hooks.listMediaAssets.mockResolvedValue([
      {
        id: 'media_1',
        userId: 'dana',
        departmentId: 'dept_rd',
        conversationId: 'c1',
        kind: 'image',
        model: 'gpt-image-2',
        filePath: '/workspace/img-1.png',
        prompt: null,
        createdAt: 1700000000000,
      },
    ]);

    render(<MediaLedgerTab />);

    await waitFor(() => expect(screen.getByText('dana')).toBeTruthy());
    expect(screen.getByText('/workspace/img-1.png')).toBeTruthy();
    expect(screen.getByText(/promptNotRetained/)).toBeTruthy();
  });

  it('renders the retained prompt when the company has opted in', async () => {
    hooks.getMediaLedgerSettings.mockResolvedValue({ retainPrompts: true });
    hooks.listMediaAssets.mockResolvedValue([
      {
        id: 'media_1',
        userId: 'dana',
        departmentId: null,
        conversationId: null,
        kind: 'video',
        model: 'seedance-2-0-fast',
        filePath: '/workspace/vid-1.mp4',
        prompt: 'a red fox running through snow',
        createdAt: 1700000000000,
      },
    ]);

    render(<MediaLedgerTab />);

    await waitFor(() => expect(screen.getByText('a red fox running through snow')).toBeTruthy());
  });

  it('toggling the retain-prompts switch saves the new setting', async () => {
    hooks.setMediaLedgerSettings.mockResolvedValue({ retainPrompts: true });
    render(<MediaLedgerTab />);

    await waitFor(() => expect(hooks.getMediaLedgerSettings).toHaveBeenCalled());
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => expect(hooks.setMediaLedgerSettings).toHaveBeenCalledWith({ retainPrompts: true }));
  });

  it('disables the prompt-search filter when retention is off', async () => {
    render(<MediaLedgerTab />);
    await waitFor(() => expect(hooks.getMediaLedgerSettings).toHaveBeenCalled());
    const promptInput = screen.getByPlaceholderText(/filterPromptDisabled/);
    expect(promptInput).toBeDisabled();
  });
});
