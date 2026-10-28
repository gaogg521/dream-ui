import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '@/common/config/storage';

const mocks = vi.hoisted(() => ({
  enterprise: false,
  selected: [] as string[],
  catalogCount: 11,
  local: vi.fn(),
  company: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseSession: () => (mocks.enterprise ? {} : null),
  isEnterpriseModeEnabled: () => mocks.enterprise,
}));
vi.mock('@/renderer/utils/enterprise/teamSkillSync', () => ({ syncTeamMcp: async () => ({ written: 1 }) }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  mcpService: { replaceSelection: { invoke: mocks.local }, listServers: { invoke: async () => [] } },
  oneDevops: {
    getMcpSelection: { invoke: async () => ({ selectedIds: mocks.selected }) },
    getMcpCatalog: {
      invoke: async ({ offset }: { offset: number }) =>
        Array.from({ length: mocks.catalogCount }, (_, i) => ({
          id: `team-${offset + i}`,
          name: `Team ${offset + i}`,
        })),
    },
    replaceMcpSelection: { invoke: mocks.company },
  },
}));
vi.mock('@arco-design/web-react', () => ({
  Alert: ({ content }: { content: string }) => <div>{content}</div>,
  Button: ({ children, onClick, disabled }: React.PropsWithChildren<{ onClick: () => void; disabled?: boolean }>) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Space: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Select: ({
    options,
    onChange,
  }: {
    options: { value: string; label: string }[];
    onChange: (ids: string[]) => void;
  }) => (
    <button
      data-testid={`select-${options[0]?.value}`}
      data-options-count={options.length}
      data-options-labels={JSON.stringify(options.map((option) => option.label))}
      onClick={() => onChange(options.map((item) => item.value))}
    >
      select
    </button>
  ),
  Message: { warning: mocks.warning, success: vi.fn(), error: vi.fn() },
}));
import McpActivationPanel from '@/renderer/pages/settings/ToolsSettings/McpActivationPanel';

const locals = Array.from({ length: 100 }, (_, i) => ({
  id: `local-${i}`,
  name: `Local ${i}`,
  enabled: false,
  builtin: false,
})) as IMcpServer[];
describe('enterprise-only MCP quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selected = [];
    mocks.catalogCount = 11;
    mocks.local.mockResolvedValue([]);
    mocks.company.mockImplementation(async ({ selectedIds }: { selectedIds: string[] }) => ({ selectedIds }));
  });
  it.each([false, true])('allows 100 locally created MCPs with enterprise=%s', async (enterprise) => {
    mocks.enterprise = enterprise;
    render(<McpActivationPanel servers={locals} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByTestId('select-local-0'));
    fireEvent.click(screen.getAllByText('settings.mcpSaveSelection')[0]);
    await waitFor(() => expect(mocks.local).toHaveBeenCalledWith({ ids: locals.map((item) => item.id) }));
    expect(mocks.warning).not.toHaveBeenCalled();
  });
  it('retains the active enterprise connector when replacing local selections', async () => {
    mocks.enterprise = true;
    const company = {
      id: 'company-active',
      name: 'Company active',
      enabled: true,
      builtin: false,
      original_json: JSON.stringify({ teamRegistryId: 'remote-id' }),
    } as IMcpServer;
    render(<McpActivationPanel servers={[...locals, company]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByTestId('select-local-0'));
    fireEvent.click(screen.getAllByText('settings.mcpSaveSelection')[0]);
    await waitFor(() =>
      expect(mocks.local).toHaveBeenCalledWith({ ids: [...locals.map((item) => item.id), 'company-active'] })
    );
  });
  it('refuses more than ten new enterprise connectors in one save', async () => {
    mocks.enterprise = true;
    render(<McpActivationPanel servers={locals} onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('select-team-0'));
    expect(mocks.warning.mock.calls.at(-1)?.[0].content.props.children).toBe('settings.mcpBatchLimit');
    expect(mocks.warning.mock.calls.at(-1)?.[0].content.props.className).toContain('text-12px');
    expect(mocks.company).not.toHaveBeenCalled();
  });
  it('allows adding ten to forty previously saved enterprise connectors', async () => {
    mocks.enterprise = true;
    mocks.selected = Array.from({ length: 40 }, (_, i) => `team-${i}`);
    mocks.catalogCount = 50;
    render(<McpActivationPanel servers={locals} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('select-team-0').getAttribute('data-options-count')).toBe('50'));
    fireEvent.click(await screen.findByTestId('select-team-0'));
    fireEvent.click(screen.getByText('settings.mcpSaveCompanySelection'));
    await waitFor(() =>
      expect(mocks.company).toHaveBeenCalledWith({ selectedIds: Array.from({ length: 50 }, (_, i) => `team-${i}`) })
    );
    expect(mocks.warning.mock.calls.at(-1)?.[0].content.props.children).toBe('settings.mcpQuotaReplace');
  });
  it('refuses the fifty-first enterprise connector even when it is only one addition', async () => {
    mocks.enterprise = true;
    mocks.selected = Array.from({ length: 50 }, (_, i) => `team-${i}`);
    mocks.catalogCount = 51;
    render(<McpActivationPanel servers={locals} onChanged={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('select-team-0').getAttribute('data-options-count')).toBe('51'));
    fireEvent.click(await screen.findByTestId('select-team-0'));
    expect(mocks.warning.mock.calls.at(-1)?.[0].content.props.children).toBe('settings.mcpQuotaReplace');
    expect(mocks.company).not.toHaveBeenCalled();
  });
  it('keeps selected connector names after paging and uses synced names before their catalog page loads', async () => {
    mocks.enterprise = true;
    mocks.selected = ['team-0', 'team-125'];
    mocks.catalogCount = 50;
    const synced = {
      id: 'synced-125',
      name: 'Synced connector',
      original_json: JSON.stringify({ teamRegistryId: 'team-125' }),
    } as IMcpServer;
    render(<McpActivationPanel servers={[...locals, synced]} onChanged={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('select-team-0').dataset.optionsLabels).toContain('Synced connector')
    );
    await waitFor(() => expect(screen.getByText('settings.mcpNextPage')).not.toBeDisabled());
    fireEvent.click(screen.getByText('settings.mcpNextPage'));
    await waitFor(() => expect(screen.getByTestId('select-team-50').dataset.optionsLabels).toContain('Team 0'));
    expect(screen.getByTestId('select-team-50').dataset.optionsLabels).toContain('Synced connector');
  });
});
