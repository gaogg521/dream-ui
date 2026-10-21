/** @vitest-environment jsdom */
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DigitalEmployeeRunRecord, PersonalAgent } from '@/common/types/employee/employeeTypes';

const mocks = vi.hoisted(() => ({ runs: vi.fn(), navigate: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { personalAgent: { listRuns: { invoke: mocks.runs } } } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => [] }));
vi.mock('@renderer/pages/conversation/hooks/useConversationAssistants', () => ({
  useConversationAssistants: () => ({ presetAssistants: [] }),
}));
import DigitalEmployeeDetailModal from '@/renderer/pages/superAssistant/components/DigitalEmployeeDetailModal';

function deferred() {
  let resolve!: (runs: DigitalEmployeeRunRecord[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<DigitalEmployeeRunRecord[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const employee = (id: string) => ({ id, name: id, agentType: 'dream', origin: 'team' }) as PersonalAgent;
const run = (summary: string) =>
  ({ id: summary, summary, status: 'success', startedAt: 1 }) as DigitalEmployeeRunRecord;

describe('employee detail request ownership', () => {
  beforeEach(() => {
    mocks.runs.mockReset();
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );
  });
  it.each(['late success', 'late failure', 'close and reopen'])('keeps B history after A %s', async (scenario) => {
    const a = deferred();
    const b = deferred();
    mocks.runs.mockImplementation(({ agentId }: { agentId: string }) => (agentId === 'A' ? a.promise : b.promise));
    const close = vi.fn();
    const view = render(<DigitalEmployeeDetailModal visible agent={employee('A')} onClose={close} />);
    if (scenario === 'close and reopen') {
      view.rerender(<DigitalEmployeeDetailModal visible={false} agent={employee('A')} onClose={close} />);
    }
    view.rerender(<DigitalEmployeeDetailModal visible agent={employee('B')} onClose={close} />);
    await act(async () => {
      b.resolve([run('B current history')]);
    });
    expect(await screen.findByText('B current history')).toBeTruthy();
    await act(async () => {
      if (scenario === 'late failure') a.reject(new Error('old A request failed'));
      else a.resolve([run('A stale history')]);
    });
    expect(screen.getByText('B current history')).toBeTruthy();
    expect(screen.queryByText('A stale history')).toBeNull();
  });
});
