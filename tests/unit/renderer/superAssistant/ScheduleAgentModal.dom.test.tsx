/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  setSchedule: vi.fn(),
  getNotification: vi.fn(),
  setNotification: vi.fn(),
  getPushTargets: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    personalAgent: {
      setSchedule: { invoke: hooks.setSchedule },
      getNotification: { invoke: hooks.getNotification },
      setNotification: { invoke: hooks.setNotification },
    },
    channel: { getPushTargets: { invoke: hooks.getPushTargets } },
  },
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, warning: hooks.warning, success: hooks.success, error: vi.fn() } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: hooks.t }),
}));

import ScheduleAgentModal from '@/renderer/pages/superAssistant/components/ScheduleAgentModal';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';

const agent = (patch: Partial<PersonalAgent>): PersonalAgent =>
  ({
    id: 'pa_1',
    name: '发布助手',
    agentType: 'dream',
    origin: 'team',
    scheduleEnabled: false,
    schedule: null,
    scheduleTask: null,
    automationConfig: { persona: 'You are the release assistant.' },
    ...patch,
  }) as PersonalAgent;

const renderModal = async (target: PersonalAgent) => {
  render(<ScheduleAgentModal visible agent={target} onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByTestId('push-target-field');
  await waitFor(() => expect(screen.getByText('确定').closest('button')).not.toBeDisabled());
};

const chooseEvery = () => fireEvent.click(screen.getByLabelText('间隔'));

describe('ScheduleAgentModal', () => {
  beforeEach(() => {
    // Arco's Grid (Form rows) subscribes to media queries on mount.
    window.matchMedia ??= ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    hooks.setSchedule.mockReset().mockResolvedValue({});
    hooks.getNotification.mockReset().mockResolvedValue({ target: null });
    hooks.setNotification.mockReset().mockResolvedValue(undefined);
    hooks.getPushTargets.mockReset().mockResolvedValue([]);
    hooks.warning.mockReset();
    hooks.success.mockReset();
  });

  it('will not schedule a company employee without a task — it has no run instructions to fall back on', async () => {
    await renderModal(agent({ origin: 'team' }));
    chooseEvery();
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.warning).toHaveBeenCalledWith('common.superAssistant.scheduleTaskRequired'));
    expect(hooks.setSchedule).not.toHaveBeenCalled();
  });

  it('sends the task with the schedule', async () => {
    await renderModal(agent({ origin: 'team' }));
    chooseEvery();
    fireEvent.change(screen.getByPlaceholderText('common.superAssistant.scheduleTaskPlaceholder'), {
      target: { value: '  汇总本周发布风险  ' },
    });
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setSchedule).toHaveBeenCalled());
    expect(hooks.setSchedule.mock.calls[0][0]).toMatchObject({
      agentId: 'pa_1',
      schedule: { enabled: true, task: '汇总本周发布风险', schedule: { kind: 'every' } },
    });
  });

  it("an employee the member built may leave the task empty — it falls back to the employee's instructions", async () => {
    await renderModal(agent({ origin: 'self_built', automationConfig: { instructions: '每日调研' } }));
    chooseEvery();
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setSchedule).toHaveBeenCalled());
    expect(hooks.setSchedule.mock.calls[0][0].schedule.task).toBeUndefined();
  });

  it('opens with the task already stored, and clearing the schedule clears the task', async () => {
    await renderModal(
      agent({
        origin: 'team',
        scheduleEnabled: true,
        schedule: { kind: 'every', every_ms: 600_000 },
        scheduleTask: '汇总本周发布风险',
      })
    );
    expect(screen.getByDisplayValue('汇总本周发布风险')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('不调度'));
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setSchedule).toHaveBeenCalled());
    expect(hooks.setSchedule.mock.calls[0][0].schedule).toEqual({
      schedule: undefined,
      enabled: false,
      task: undefined,
    });
  });

  it('does not overwrite settings when the saved notification preference cannot be loaded', async () => {
    hooks.getNotification.mockRejectedValue(new Error('offline'));
    render(<ScheduleAgentModal visible agent={agent({})} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(hooks.getNotification).toHaveBeenCalled());
    expect(screen.getByText('确定').closest('button')).toBeDisabled();
    expect(hooks.setNotification).not.toHaveBeenCalled();
  });

  it('saves a recipient without requiring permission to manage the employee schedule', async () => {
    hooks.setSchedule.mockRejectedValue(new Error('schedule management forbidden'));
    const target = { plugin_id: 'telegram', chat_id: 'private-chat' };
    hooks.getNotification.mockResolvedValue({ target });
    hooks.getPushTargets.mockResolvedValue([
      {
        pluginId: 'telegram',
        type: 'telegram',
        name: 'Telegram',
        connected: true,
        chats: [{ chatId: 'private-chat' }],
      },
    ]);
    await renderModal(agent({}));
    await waitFor(() => expect(screen.getByText('确定').closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setNotification).toHaveBeenCalledWith({ agentId: 'pa_1', target }));
    expect(hooks.setSchedule).not.toHaveBeenCalled();
  });

  it('preserves an interval of 90 seconds when only notification settings are saved', async () => {
    await renderModal(
      agent({ origin: 'self_built', schedule: { kind: 'every', every_ms: 90000 }, scheduleEnabled: true })
    );
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setNotification).toHaveBeenCalled());
    expect(hooks.setSchedule).not.toHaveBeenCalled();
  });

  it('requires a connected recipient when notifications are enabled', async () => {
    await renderModal(agent({}));
    fireEvent.click(screen.getByTestId('push-target-switch'));
    await waitFor(() => expect(screen.getByText('确定').closest('button')).toBeDisabled());
    expect(hooks.setNotification).not.toHaveBeenCalled();
  });

  it('keeps the form open if saving the recipient fails', async () => {
    hooks.setNotification.mockRejectedValue(new Error('recipient disconnected'));
    await renderModal(agent({}));
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setNotification).toHaveBeenCalled());
    expect(hooks.setSchedule).not.toHaveBeenCalled();
    expect(hooks.success).not.toHaveBeenCalled();
  });
});
