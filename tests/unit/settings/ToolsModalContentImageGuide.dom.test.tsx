/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsTabNavigateProvider } from '@/renderer/components/settings/SettingsModal/settingsViewContext';

const hooks = vi.hoisted(() => ({
  modelListWithImage: [] as unknown[],
  mcpServers: [] as unknown[],
  getClientBusinessSetting: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue) return options.defaultValue as string;
      // Minimal interpolation so `{{model}}`-style keys are assertable.
      const interpolated = Object.entries(options ?? {})
        .filter(([k]) => k !== 'defaultValue')
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ');
      return interpolated ? `${key} ${interpolated}` : key;
    },
  }),
}));

vi.mock('@/renderer/components/base/DreamScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/DreamSelect', () => {
  const Select = ({ children, placeholder }: { children?: React.ReactNode; placeholder?: React.ReactNode }) => (
    <div>
      {placeholder != null && <span data-testid='select-placeholder'>{placeholder}</span>}
      {children}
    </div>
  );
  return { default: Object.assign(Select, { OptGroup: Select, Option: Select }) };
});

vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({
  default: () => <div>TalkToButlerButton</div>,
}));

vi.mock('@/renderer/pages/settings/components/AddMcpServerModal', () => ({
  default: () => null,
}));

vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerItem', () => ({
  default: () => null,
}));

vi.mock('@/renderer/hooks/agent/useConfigModelListWithImage', () => ({
  default: () => ({ modelListWithImage: hooks.modelListWithImage }),
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
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: {},
}));

import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';

describe('ToolsModalContent image model guide', () => {
  beforeEach(() => {
    hooks.modelListWithImage = [];
    hooks.mcpServers = [];
    hooks.getClientBusinessSetting.mockClear();
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

  it('renders a clickable "go to configure" link that navigates to the model tab', async () => {
    const navigateToTab = vi.fn();
    render(
      <MemoryRouter>
        <SettingsTabNavigateProvider value={navigateToTab}>
          <ToolsModalContent />
        </SettingsTabNavigateProvider>
      </MemoryRouter>
    );

    // Both the image and the video empty states offer the hint, so match all of
    // them: each must be a real button, not just the first one.
    const links = await screen.findAllByText('settings.goToModelSettings');
    expect(links.length).toBeGreaterThan(0);
    // Rendered as an inline text-styled button (triggers programmatic
    // navigation via the tab navigator, not a real href), not an anchor.
    links.forEach((link) => expect(link.tagName).toBe('BUTTON'));

    for (const link of links) {
      navigateToTab.mockClear();
      fireEvent.click(link);
      await waitFor(() => expect(navigateToTab).toHaveBeenCalledWith('model'));
    }
  });

  it('renders the guide text as plain text (no link) when no tab navigator is provided', async () => {
    const { container } = render(
      <MemoryRouter>
        <ToolsModalContent />
      </MemoryRouter>
    );

    // The empty-state hint still shows the go-to-configure wording, but not as a clickable link.
    await waitFor(() => expect(container.textContent).toContain('settings.goToModelSettings'));
    const links = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'settings.goToModelSettings'
    );
    expect(links).toHaveLength(0);
  });

  it('shows the fallback media model as the select placeholder when nothing is explicitly picked', async () => {
    // A provider that declares a seedream image model and a seedance video model —
    // both resolved by the built-in catalog, so `findDeclaredMediaModel` returns
    // them even though `tools.imageGenerationModel` / `tools.videoGenerationModel`
    // are unset.
    hooks.modelListWithImage = [
      {
        id: 'gw',
        name: 'Gateway',
        platform: 'custom',
        base_url: 'https://gw.example.com/v1',
        api_key: 'sk-x',
        models: ['doubao-seedream-5-0-pro', 'seedance-2-0-fast'],
      },
    ];

    render(
      <MemoryRouter>
        <ToolsModalContent />
      </MemoryRouter>
    );

    const placeholders = await screen.findAllByTestId('select-placeholder');
    const text = placeholders.map((n) => n.textContent).join(' | ');
    expect(text).toContain('doubao-seedream-5-0-pro');
    expect(text).toContain('seedance-2-0-fast');
    // interpolation key, not a bare "select model"
    expect(text).toContain('settings.mediaModelAutoPlaceholder');
  });
});
