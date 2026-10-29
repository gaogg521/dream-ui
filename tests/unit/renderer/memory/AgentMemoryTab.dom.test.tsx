/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({
  agentList: vi.fn(),
  agentRead: vi.fn(),
  agentWrite: vi.fn(),
  agentOpen: vi.fn(),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  memory: {
    agentList: { invoke: ipc.agentList },
    agentRead: { invoke: ipc.agentRead },
    agentWrite: { invoke: ipc.agentWrite },
    agentOpen: { invoke: ipc.agentOpen },
  },
}));

// A stable `t`, like react-i18next's: a fresh function each render would re-run the load effects.
const t = (key: string, vars?: Record<string, unknown>) =>
  vars && Object.keys(vars).length > 0 ? `${key} ${JSON.stringify(vars)}` : key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));

vi.mock('@renderer/components/agent/AgentBadge', () => ({
  AgentLogoIcon: ({ backend }: { backend: string }) => <span data-logo={backend} />,
}));
vi.mock('@/renderer/pages/memory/ClaudeAutoMemory', () => ({ default: () => <div data-testid='claude-auto' /> }));
vi.mock('@/renderer/pages/memory/ProjectRootCard', () => ({ default: () => <div data-testid='root-card' /> }));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } };
});

import AgentMemoryTab from '@/renderer/pages/memory/AgentMemoryTab';

const agent = (key: string, label: string, used: boolean) => ({
  key,
  label,
  used,
  globalPath: `/home/${key}/INSTRUCTIONS.md`,
  globalExists: used,
  projectFileName: 'AGENTS.md',
});

describe('AgentMemoryTab', () => {
  beforeEach(() => {
    Object.values(ipc).forEach((fn) => fn.mockReset());
    ipc.agentList.mockResolvedValue([
      agent('claude', 'Claude Code', false),
      agent('codex', 'Codex', true),
      agent('gemini', 'Gemini CLI', false),
    ]);
    ipc.agentRead.mockImplementation(async ({ agent: key }: { agent: string }) => ({
      path: `/home/${key}/INSTRUCTIONS.md`,
      exists: key === 'codex',
      content: key === 'codex' ? 'be concise' : '',
    }));
    ipc.agentWrite.mockResolvedValue(undefined);
  });

  it('lists the agents with the ones used on this computer first and opens the first of them', async () => {
    render(<AgentMemoryTab />);
    await screen.findByTestId('agent-memory-tab');
    const cards = Array.from(document.querySelectorAll('[data-agent]'));
    expect(cards.map((c) => c.getAttribute('data-agent'))).toEqual(['codex', 'claude', 'gemini']);
    await waitFor(() => expect(ipc.agentRead).toHaveBeenCalledWith({ agent: 'codex', scope: 'global' }));
    expect(await screen.findByDisplayValue('be concise')).toBeTruthy();
  });

  it("shows another agent's file when its card is picked", async () => {
    render(<AgentMemoryTab />);
    await screen.findByDisplayValue('be concise');

    fireEvent.click(screen.getAllByRole('tab').find((c) => c.getAttribute('data-agent') === 'gemini')!);

    await waitFor(() => expect(ipc.agentRead).toHaveBeenCalledWith({ agent: 'gemini', scope: 'global' }));
    await waitFor(() => expect(screen.queryByDisplayValue('be concise')).toBeNull());
    expect(screen.getByText(/memory\.agents\.willCreate/)).toBeTruthy();
  });

  it('saves edits to the chosen agent only, and the save button waits for a change', async () => {
    render(<AgentMemoryTab />);
    const box = await screen.findByDisplayValue('be concise');
    const save = screen.getByText('memory.save').closest('button')!;
    expect(save.disabled).toBe(true);

    fireEvent.change(box, { target: { value: 'be concise and kind' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(ipc.agentWrite).toHaveBeenCalledWith({ agent: 'codex', scope: 'global', content: 'be concise and kind' })
    );
  });

  it('offers the auto-memory page only for Claude Code', async () => {
    render(<AgentMemoryTab />);
    await screen.findByDisplayValue('be concise');
    expect(screen.queryByText('memory.agents.auto')).toBeNull();

    fireEvent.click(screen.getAllByRole('tab').find((c) => c.getAttribute('data-agent') === 'claude')!);
    expect(await screen.findByText('memory.agents.auto')).toBeTruthy();
  });

  it('says so when no agent file can be read at all', async () => {
    ipc.agentList.mockResolvedValue([]);
    render(<AgentMemoryTab />);
    expect(await screen.findByTestId('agent-memory-tab')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
