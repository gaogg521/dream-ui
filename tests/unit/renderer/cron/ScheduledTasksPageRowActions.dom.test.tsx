/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICronJob } from '@/common/adapter/ipcBridge';

const mocks = vi.hoisted(() => ({
  jobs: [] as unknown[],
  navigate: vi.fn(),
  removeJob: vi.fn(),
  dialogProps: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return { ...actual, Message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});
vi.mock('@/common', () => ({
  ipcBridge: { cron: { removeJob: { invoke: (...args: unknown[]) => mocks.removeJob(...args) } } },
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  systemSettings: { getKeepAwake: { invoke: vi.fn(async () => false) }, setKeepAwake: { invoke: vi.fn() } },
}));
vi.mock('@/common/config/configService', () => ({
  configService: { get: vi.fn(() => false), getLocal: vi.fn(() => false), setLocal: vi.fn() },
}));
vi.mock('@renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@renderer/pages/cron/useCronJobs', () => ({
  useAllCronJobs: () => ({ jobs: mocks.jobs, loading: false, pauseJob: vi.fn(), resumeJob: vi.fn() }),
}));
vi.mock('@renderer/pages/conversation/hooks/useConversationAssistants', () => ({
  useConversationAssistants: () => ({ presetAssistants: [] }),
}));
vi.mock('@renderer/utils/model/agentLogo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@renderer/utils/model/agentLogo')>()),
  useAgentLogos: () => ({}),
}));
vi.mock('@/renderer/components/agent/ThemedLogo', () => ({ default: () => null }));
vi.mock('@/renderer/components/base/TalkToButlerButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/base', () => ({
  DreamSearchInput: () => null,
}));
vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock('@renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog', () => ({
  default: (props: { visible: boolean; editJob?: ICronJob }) => {
    mocks.dialogProps(props);
    return props.visible && props.editJob ? <div data-testid='edit-dialog'>{props.editJob.name}</div> : null;
  },
}));

import ScheduledTasksPage from '@/renderer/pages/cron/ScheduledTasksPage';

const job = (id: string, name: string): ICronJob => ({
  id,
  name,
  enabled: true,
  schedule: { kind: 'cron', expr: '30 8 * * *', description: 'Every day' },
  target: { payload: { kind: 'message', text: 'go' }, execution_mode: 'new_conversation' },
  metadata: {
    conversation_id: '',
    agent_type: 'dream',
    created_by: 'user',
    created_at: 1,
    updated_at: 1,
  },
  state: { run_count: 0, retry_count: 0, max_retries: 3, queue_enabled: false },
});

describe('automation list row shortcuts', () => {
  beforeEach(() => {
    mocks.jobs = [job('j1', 'Daily words'), job('j2', 'Weekly report')];
    mocks.navigate.mockReset();
    mocks.removeJob.mockReset();
    mocks.removeJob.mockResolvedValue(undefined);
  });

  it('puts an edit and a delete button on every row', () => {
    render(<ScheduledTasksPage />);
    expect(screen.getByTestId('cron-row-edit-j1')).toBeInTheDocument();
    expect(screen.getByTestId('cron-row-delete-j1')).toBeInTheDocument();
    expect(screen.getByTestId('cron-row-edit-j2')).toBeInTheDocument();
    expect(screen.getByTestId('cron-row-delete-j2')).toBeInTheDocument();
  });

  it('edit opens the form for that row without leaving the list', () => {
    render(<ScheduledTasksPage />);
    fireEvent.click(screen.getByTestId('cron-row-edit-j2'));
    expect(screen.getByTestId('edit-dialog')).toHaveTextContent('Weekly report');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('delete asks first, then removes only that job', async () => {
    render(<ScheduledTasksPage />);
    fireEvent.click(screen.getByTestId('cron-row-delete-j1'));
    expect(mocks.removeJob).not.toHaveBeenCalled();
    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('.arco-popconfirm-btn .arco-btn-primary');
      if (!button) throw new Error('confirmation not shown yet');
      return button;
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.removeJob).toHaveBeenCalledWith({ job_id: 'j1' }));
    expect(mocks.removeJob).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
