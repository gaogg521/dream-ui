/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IProvider } from '@/common/config/storage';
import { SettingsTabNavigateProvider } from '@/renderer/components/settings/SettingsModal/settingsViewContext';

const hooks = vi.hoisted(() => ({
  providers: [] as IProvider[],
  mcpServers: [] as unknown[],
  getClientBusinessSetting: vi.fn(() => Promise.resolve(undefined)),
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('@/renderer/components/base/DreamScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({
  default: () => <div>TalkToButlerButton</div>,
}));

vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: hooks.providers }),
}));

vi.mock('@/renderer/hooks/mcp', () => ({
  useMcpServers: () => ({
    mcpServers: hooks.mcpServers,
    extensionMcpServers: [],
    saveMcpServers: vi.fn(() => Promise.resolve()),
    setMcpServers: vi.fn(),
    isMcpServersLoading: false,
  }),
  useMcpConnection: () => ({ testingServers: {}, handleTestMcpConnection: vi.fn(), handleTestMcpConnections: vi.fn() }),
  useMcpModal: () => ({
    showMcpModal: false,
    editingMcpServer: undefined,
    deleteConfirmVisible: false,
    serverToDelete: undefined,
    mcpCollapseKey: [],
    showAddMcpModal: vi.fn(),
    showEditMcpModal: vi.fn(),
    hideMcpModal: vi.fn(),
    showDeleteConfirm: vi.fn(),
    hideDeleteConfirm: vi.fn(),
    toggleServerCollapse: vi.fn(),
  }),
  useMcpServerCRUD: () => ({
    handleAddMcpServer: vi.fn(),
    handleBatchImportMcpServers: vi.fn(),
    handleEditMcpServer: vi.fn(),
    handleDeleteMcpServer: vi.fn(),
  }),
  useMcpOAuth: () => ({
    oauthStatus: {},
    loggingIn: {},
    checkOAuthStatus: vi.fn(),
    markLoginRequired: vi.fn(),
    clearLoginRequired: vi.fn(),
    login: vi.fn(),
  }),
  useMountedMessage: (m: unknown) => m,
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: hooks.getClientBusinessSetting,
  setClientBusinessSetting: hooks.setClientBusinessSetting,
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {},
}));

import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

describe('ToolsModalContent media sections', () => {
  beforeEach(() => {
    hooks.providers = [];
    hooks.mcpServers = [];
    hooks.getClientBusinessSetting.mockClear();
    hooks.setClientBusinessSetting.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the "declare a model" summary and a go-to-Models button, not a model dropdown', async () => {
    const navigateToTab = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <SettingsTabNavigateProvider value={navigateToTab}>
          <ToolsModalContent />
        </SettingsTabNavigateProvider>
      </MemoryRouter>
    );

    // The model is no longer picked here — the section reports the current one
    // (none, in this case) and points at Settings > Models.
    await waitFor(() => expect(screen.getAllByText('settings.mediaModelUndeclared').length).toBeGreaterThan(0));
    // No <select>/combobox: the redundant per-tools model picker is gone.
    expect(container.querySelector('select')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    const links = screen.getAllByText('settings.goToModelSettings');
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => expect(link.tagName).toBe('BUTTON'));
    for (const link of links) {
      navigateToTab.mockClear();
      fireEvent.click(link);
      await waitFor(() => expect(navigateToTab).toHaveBeenCalledWith('model'));
    }
  });

  it('renders the go-to-configure control as a button, never an anchor', async () => {
    const { container } = render(
      <MemoryRouter>
        <ToolsModalContent />
      </MemoryRouter>
    );

    await waitFor(() => expect(container.textContent).toContain('settings.goToModelSettings'));
    const anchors = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'settings.goToModelSettings'
    );
    expect(anchors).toHaveLength(0);
  });

  // Two channels both declare gpt-image-2 as an image model — the exact
  // ambiguity that made the assistant's autonomous tool call silently resolve
  // to "whichever channel is first" with no way to see or change it.
  it('shows which channel the model resolves to, and lets the user switch it', async () => {
    hooks.providers = [
      {
        id: 'p1',
        platform: 'openai',
        name: 'Channel One',
        base_url: '',
        api_key: '',
        models: ['gpt-image-2'],
      },
      {
        id: 'p2',
        platform: 'openai',
        name: 'Channel Two',
        base_url: '',
        api_key: '',
        models: ['gpt-image-2'],
      },
    ] as IProvider[];

    render(
      <MemoryRouter>
        <ToolsModalContent />
      </MemoryRouter>
    );

    // No explicit default yet: falls back to the first declared candidate
    // (provider order), and says so — not just the bare model name.
    await waitFor(() => expect(screen.getAllByText('gpt-image-2 · Channel One').length).toBeGreaterThan(0));

    // Opening the picker offers both channels, grouped, not a flat list that
    // hides which one is which.
    const [trigger] = screen.getAllByText('gpt-image-2 · Channel One');
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText('Channel Two')).toBeInTheDocument());

    // Each group's row is labelled with the bare model name; Channel One's row
    // renders first (provider order), so the second occurrence is Channel Two's.
    const options = screen.getAllByText('gpt-image-2');
    expect(options.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(options[options.length - 1]);

    // Persisted through the same setting the send box's own picker writes.
    await waitFor(() => expect(hooks.setClientBusinessSetting).toHaveBeenCalled());
    const [key, value] = hooks.setClientBusinessSetting.mock.calls[0];
    expect(key).toBe('tools.imageGenerationModel');
    expect(value).toMatchObject({ id: 'p2', name: 'Channel Two', use_model: 'gpt-image-2' });

    // Reflected immediately, without waiting on a re-fetch.
    await waitFor(() => expect(screen.getAllByText('gpt-image-2 · Channel Two').length).toBeGreaterThan(0));
  });

  it('still shows a picker (not just plain text) with a single declared candidate', async () => {
    hooks.providers = [
      {
        id: 'p1',
        platform: 'openai',
        name: 'Only Channel',
        base_url: '',
        api_key: '',
        models: ['gpt-image-2'],
      },
    ] as IProvider[];

    render(
      <MemoryRouter>
        <ToolsModalContent />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getAllByText('gpt-image-2 · Only Channel').length).toBeGreaterThan(0));
    // A single candidate is still shown as a clickable picker rather than bare
    // text: that is what proves the channel to the user, and it is where they
    // would notice a second channel was declared later.
    expect(screen.queryAllByRole('button', { name: /gpt-image-2/ }).length).toBeGreaterThan(0);
  });
});
