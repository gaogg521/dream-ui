/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * Verifies McpServerHeader only renders the FeedbackButton when the server
 * status is 'error', and that it is wired to module=mcp-tools.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';
import { SWRConfig } from 'swr';
import zhSettings from '@/renderer/services/i18n/locales/zh-CN/settings.json';
import enSettings from '@/renderer/services/i18n/locales/en-US/settings.json';

let language = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'settings.mcpPurposeMarket' && language === 'zh-CN') return zhSettings.mcpPurposeMarket;
      if (key === 'settings.mcpToolSearchTeamKnowledge') {
        return (language === 'zh-CN' ? zhSettings : enSettings).mcpToolSearchTeamKnowledge;
      }
      return key;
    },
    i18n: { language },
  }),
}));

const noteSettings = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: noteSettings.read,
  setClientBusinessSetting: noteSettings.write,
}));
vi.mock('@/renderer/pages/settings/ToolsSettings/WebSearchProviderConfig', () => ({ default: () => null }));
vi.mock('@/renderer/pages/settings/ToolsSettings/McpServerToolsList', () => ({ default: () => null }));

const openFeedbackMock = vi.fn(() => Promise.resolve());
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: openFeedbackMock }),
}));

import McpServerItem, { McpServerGrid } from '@/renderer/pages/settings/ToolsSettings/McpServerItem';
import McpServerHeader from '@/renderer/pages/settings/ToolsSettings/McpServerHeader';
import type { IMcpServer } from '@/common/config/storage';

const buildServer = (last_test_status: IMcpServer['last_test_status']): IMcpServer =>
  ({
    id: 's1',
    name: 'my-server',
    enabled: true,
    transport: { type: 'http', url: 'http://example' },
    last_test_status,
    created_at: 0,
    updated_at: 0,
    original_json: '',
  }) as IMcpServer;

const commonProps = {
  isTestingConnection: false,
  onTestConnection: vi.fn(),
  onEditServer: vi.fn(),
  onDeleteServer: vi.fn(),
};

const renderHeader = (last_test_status: IMcpServer['last_test_status']) =>
  render(
    <ConfigProvider>
      <McpServerHeader server={buildServer(last_test_status)} {...commonProps} />
    </ConfigProvider>
  );

describe('McpServerHeader — FeedbackButton wiring', () => {
  beforeEach(() => {
    openFeedbackMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a connected but disabled MCP as off and makes the switch request activation', async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    const server = { ...buildServer('connected'), enabled: false };
    const { rerender } = render(
      <ConfigProvider>
        <McpServerHeader server={server} {...commonProps} onEnabledChange={onEnabledChange} />
      </ConfigProvider>
    );
    const control = screen.getByRole('switch', { name: server.name });
    expect(control).not.toBeChecked();
    expect(screen.getByText('settings.mcpDisabledLabel')).toBeInTheDocument();
    expect(screen.getByText('settings.mcpCheckPassedSimple')).toBeInTheDocument();
    await user.click(control);
    expect(onEnabledChange).toHaveBeenCalledWith(true);
    expect(control).not.toBeChecked();

    rerender(
      <ConfigProvider>
        <McpServerHeader server={{ ...server, enabled: true }} {...commonProps} onEnabledChange={onEnabledChange} />
      </ConfigProvider>
    );
    expect(control).toBeChecked();
    expect(screen.getByText('settings.mcpEnabledLabel')).toBeInTheDocument();
  });

  it('does not render FeedbackButton on connected status', () => {
    renderHeader('connected');
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });

  it('does not render FeedbackButton while testing', () => {
    renderHeader('testing');
    expect(screen.queryByText('settings.oneClickFeedback')).not.toBeInTheDocument();
  });

  it('renders FeedbackButton when server status is error', () => {
    renderHeader('error');
    expect(screen.getByText('settings.oneClickFeedback')).toBeInTheDocument();
  });

  it('click opens feedback with module=mcp-tools', async () => {
    const user = userEvent.setup();
    renderHeader('error');
    await user.click(screen.getByText('settings.oneClickFeedback'));

    expect(openFeedbackMock).toHaveBeenCalledTimes(1);
    expect(openFeedbackMock).toHaveBeenCalledWith({
      module: 'mcp-tools',
      autoScreenshot: true,
    });
  });
});

it('shows a localized built-in purpose and persists a personal override without replacing the server description', async () => {
  language = 'zh-CN';
  const user = userEvent.setup();
  const server = {
    ...buildServer('connected'),
    name: 'stock-sdk',
    builtin: true,
    description: 'Default MCP server: stock-sdk',
  };
  let stored = { other: 'Other server' } as Record<string, string>;
  noteSettings.read.mockImplementation(async () => stored);
  noteSettings.write.mockImplementation(async (_key, value) => {
    stored = value;
  });
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ConfigProvider>
        <McpServerGrid>
          <McpServerItem server={server} isCollapsed={false} onToggleCollapse={() => {}} {...commonProps} />
        </McpServerGrid>
      </ConfigProvider>
    </SWRConfig>
  );

  expect(screen.getByTestId('mcp-server-grid')).toBeInTheDocument();
  expect(screen.getByText(zhSettings.mcpPurposeMarket)).toBeInTheDocument();
  const edit = () => user.click(screen.getByRole('button', { name: 'settings.mcpEditPurpose' }));
  const save = () => user.click(screen.getByRole('button', { name: 'common.save' }));
  await edit();
  const input = screen.getByRole('textbox', { name: 'settings.mcpEditPurpose' });
  await user.type(input, '重点看持仓行情');
  await save();
  expect(await screen.findByText('重点看持仓行情')).toBeInTheDocument();
  expect(stored).toEqual({ other: 'Other server', s1: '重点看持仓行情' });
  await edit();
  await user.clear(screen.getByRole('textbox', { name: 'settings.mcpEditPurpose' }));
  await save();
  await waitFor(() => expect(screen.getByText(zhSettings.mcpPurposeMarket)).toBeInTheDocument());
  expect(stored).toEqual({ other: 'Other server' });
  language = 'en';
});

it('switches the knowledge search description with the UI language and preserves its tool name', async () => {
  const { default: ToolsList } = await vi.importActual<
    typeof import('@/renderer/pages/settings/ToolsSettings/McpServerToolsList')
  >('@/renderer/pages/settings/ToolsSettings/McpServerToolsList');
  const tool = { name: 'search_team_knowledge', description: 'Original server description' };
  const server = { ...buildServer('connected'), name: 'one-team-knowledge', builtin: true, tools: [tool] };
  language = 'zh-CN';
  const { rerender } = render(<ToolsList server={server} />);
  expect(screen.getByText(tool.name)).toHaveAttribute('title', tool.name);
  expect(screen.getByText(zhSettings.mcpToolSearchTeamKnowledge)).toBeInTheDocument();

  language = 'en';
  rerender(<ToolsList server={server} />);
  expect(screen.getByText(tool.name)).toHaveAttribute('title', tool.name);
  expect(screen.getByText(enSettings.mcpToolSearchTeamKnowledge)).toBeInTheDocument();

  rerender(<ToolsList server={{ ...server, builtin: false }} />);
  expect(screen.getByText(tool.description)).toBeInTheDocument();
});

it('keeps the three MCP cards on their original row when the middle one expands', () => {
  const width = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(DOMRect.fromRect({ width: 900 }));
  const servers = ['pdf', 'knowledge', 'browser', 'search'];
  const layout = (expanded: boolean) => (
    <ConfigProvider>
      <McpServerGrid>
        {servers.map((name) => (
          <McpServerItem
            key={name}
            server={{ ...buildServer('connected'), id: name, name }}
            isCollapsed={expanded && name === 'knowledge'}
            onToggleCollapse={() => {}}
            {...commonProps}
          />
        ))}
      </McpServerGrid>
    </ConfigProvider>
  );
  const card = (name: string) => screen.getByRole('button', { name }).parentElement;
  try {
    const { rerender } = render(layout(false));
    expect(card('knowledge')).toHaveStyle({ gridRow: '1', gridColumn: '2' });
    rerender(layout(true));
    expect(card('pdf')).toHaveStyle({ gridRow: '1', gridColumn: '1' });
    expect(card('knowledge')).toHaveStyle({ gridRow: '1', gridColumn: '2' });
    expect(card('browser')).toHaveStyle({ gridRow: '1', gridColumn: '3' });
    expect(screen.getByRole('region', { name: 'knowledge' })).toHaveStyle({ gridRow: '2' });
    expect(card('search')).toHaveStyle({ gridRow: '3', gridColumn: '1' });
  } finally {
    width.mockRestore();
  }
});

it('localizes browser tool descriptions while keeping a third-party tool with the same name intact', async () => {
  const { default: ToolsList } = await vi.importActual<
    typeof import('@/renderer/pages/settings/ToolsSettings/McpServerToolsList')
  >('@/renderer/pages/settings/ToolsSettings/McpServerToolsList');
  language = 'zh-CN';
  const tools = [{ name: 'get_console_message', description: 'Read one console entry' }];
  const builtin = { ...buildServer('connected'), name: 'one-browser', builtin: true, tools };
  const { rerender } = render(<ToolsList server={builtin} />);
  expect(screen.getByTestId('mcp-tool-grid')).toBeInTheDocument();
  expect(screen.getByText('get_console_message')).toHaveAttribute('title', 'get_console_message');
  expect(screen.getByText('按 ID 查看控制台消息。')).toBeInTheDocument();

  rerender(<ToolsList server={{ ...builtin, builtin: false }} />);
  expect(screen.getByText('get_console_message')).toBeInTheDocument();
  expect(screen.getByText('Read one console entry')).toBeInTheDocument();
  language = 'en';
});
