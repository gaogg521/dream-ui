/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ setSchedule: vi.fn(), warning: vi.fn(), success: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: { personalAgent: { setSchedule: { invoke: hooks.setSchedule } } },
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, warning: hooks.warning, success: hooks.success, error: vi.fn() } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
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

const renderModal = (target: PersonalAgent) =>
  render(<ScheduleAgentModal visible agent={target} onClose={vi.fn()} onSaved={vi.fn()} />);

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
    hooks.warning.mockReset();
    hooks.success.mockReset();
  });

  it('will not schedule a company employee without a task — it has no run instructions to fall back on', async () => {
    renderModal(agent({ origin: 'team' }));
    chooseEvery();
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.warning).toHaveBeenCalledWith('common.superAssistant.scheduleTaskRequired'));
    expect(hooks.setSchedule).not.toHaveBeenCalled();
  });

  it('sends the task with the schedule', async () => {
    renderModal(agent({ origin: 'team' }));
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
    renderModal(agent({ origin: 'self_built', automationConfig: { instructions: '每日调研' } }));
    chooseEvery();
    fireEvent.click(screen.getByText('确定'));
    await waitFor(() => expect(hooks.setSchedule).toHaveBeenCalled());
    expect(hooks.setSchedule.mock.calls[0][0].schedule.task).toBeUndefined();
  });

  it('opens with the task already stored, and clearing the schedule clears the task', async () => {
    renderModal(
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
});
