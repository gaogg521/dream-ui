/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ runs: vi.fn(async () => []), assistants: [], catalog: [] }));
vi.mock('@/common', () => ({ ipcBridge: { personalAgent: { listRuns: { invoke: mocks.runs } } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => mocks.catalog }));
vi.mock('@renderer/pages/conversation/hooks/useConversationAssistants', () => ({
  useConversationAssistants: () => ({ presetAssistants: mocks.assistants }),
}));
import AgentsTab from '@/renderer/pages/superAssistant/components/AgentsTab';
import type { DigitalEmployeeWithRuns } from '@/renderer/pages/superAssistant/hooks/useDigitalEmployees';

const agents = Array.from(
  { length: 500 },
  (_, i) =>
    ({
      id: `employee-${i + 1}`,
      name: `Employee ${String(i + 1).padStart(3, '0')}`,
      description: i === 499 ? 'Unique last-page expert' : '',
      agentType: 'dream',
      origin: 'team',
      recentRuns: [],
    }) as DigitalEmployeeWithRuns
);

describe('large distributed employee rosters', () => {
  beforeEach(() => mocks.runs.mockClear());
  it('renders and loads history for only the current page, and searches across all 500 rows', async () => {
    const start = vi.fn();
    render(<AgentsTab agents={agents} onStartChat={start} />);
    expect(screen.getAllByText('common.superAssistant.startChat')).toHaveLength(20);
    await waitFor(() => expect(mocks.runs).toHaveBeenCalledTimes(20));
    fireEvent.click(screen.getByText('2', { selector: 'li' }));
    await screen.findByText('Employee 021');
    expect(screen.queryByText('Employee 001')).toBeNull();
    await waitFor(() => expect(mocks.runs).toHaveBeenCalledTimes(40));
    fireEvent.change(screen.getByPlaceholderText('common.superAssistant.searchEmployees'), {
      target: { value: 'unique last-page' },
    });
    await screen.findByText('Employee 500');
    expect(screen.getAllByText('common.superAssistant.startChat')).toHaveLength(1);
    fireEvent.click(screen.getByText('common.superAssistant.startChat'));
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'employee-500' }));
    fireEvent.change(screen.getByPlaceholderText('common.superAssistant.searchEmployees'), {
      target: { value: 'no such employee' },
    });
    expect(screen.getByText('common.superAssistant.noMatchingEmployees')).toBeTruthy();
  });
  it('keeps other cards usable when a history request fails and clamps the page after removal', async () => {
    mocks.runs.mockRejectedValueOnce(new Error('history unavailable'));
    const view = render(<AgentsTab agents={agents} />);
    fireEvent.click(screen.getByText('2', { selector: 'li' }));
    await screen.findByText('Employee 021');
    view.rerender(<AgentsTab agents={agents.slice(0, 1)} />);
    expect(await screen.findByText('Employee 001')).toBeTruthy();
    expect(screen.getAllByText('common.superAssistant.startChat')).toHaveLength(1);
  });
});
