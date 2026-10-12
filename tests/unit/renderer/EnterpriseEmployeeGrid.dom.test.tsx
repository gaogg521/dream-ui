/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({
  list: vi.fn(),
  startEmployeeChat: vi.fn(),
  navigate: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: { personalAgent: { list: { invoke: hooks.list } } },
}));
vi.mock('@/renderer/pages/superAssistant/utils/startEmployeeChat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/renderer/pages/superAssistant/utils/startEmployeeChat')>()),
  startEmployeeChat: hooks.startEmployeeChat,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => hooks.navigate }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, error: hooks.error } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count !== undefined ? `${key}:${options.count}` : key),
  }),
}));

import { BackendHttpError } from '@/common/adapter/httpBridge';
import EnterpriseEmployeeGrid from '@/renderer/components/enterprise/EnterpriseEmployeeGrid';

const TEAM_EMPLOYEE = {
  id: 'pa_team',
  name: '周报助手',
  description: '帮你起草周报',
  agentType: 'dream',
  origin: 'team',
  automationConfig: {
    persona: 'You draft weekly reports.',
    boundSkillIds: ['oskill_a', 'oskill_b'],
    boundMcpIds: ['omcp_a'],
    starterPrompts: ['起草本周周报'],
  },
};
const OWN_EMPLOYEE = { ...TEAM_EMPLOYEE, id: 'pa_own', name: '我自己的员工', origin: 'self_built' };

const renderGrid = () =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <EnterpriseEmployeeGrid />
    </SWRConfig>
  );

describe('EnterpriseEmployeeGrid', () => {
  beforeEach(() => {
    hooks.list.mockReset().mockResolvedValue([TEAM_EMPLOYEE, OWN_EMPLOYEE]);
    hooks.startEmployeeChat.mockReset().mockResolvedValue('conv_1');
    hooks.navigate.mockReset();
    hooks.error.mockReset();
  });

  it('lists only the employees the company distributed, with what they carry', async () => {
    renderGrid();
    expect(await screen.findByText('周报助手')).toBeInTheDocument();
    expect(screen.queryByText('我自己的员工')).not.toBeInTheDocument();
    expect(screen.getByText('帮你起草周报')).toBeInTheDocument();
    expect(screen.getByText('common.superAssistant.boundSkillsCount:2')).toBeInTheDocument();
    expect(screen.getByText('common.superAssistant.boundToolsCount:1')).toBeInTheDocument();
  });

  it('a starter prompt opens a chat that sends it; the button opens an empty one', async () => {
    renderGrid();
    fireEvent.click(await screen.findByText('起草本周周报'));
    await waitFor(() => expect(hooks.startEmployeeChat).toHaveBeenCalledWith('pa_team', hooks.navigate, '起草本周周报'));

    fireEvent.click(screen.getByText('common.superAssistant.startChat'));
    await waitFor(() => expect(hooks.startEmployeeChat).toHaveBeenLastCalledWith('pa_team', hooks.navigate, undefined));
  });

  it('says the employee is gone when the backend no longer lets the member use it', async () => {
    hooks.startEmployeeChat.mockRejectedValue(
      new BackendHttpError({ method: 'POST', path: '/api/one/employee/agents/pa_team/chat', status: 404, body: {} })
    );
    renderGrid();
    fireEvent.click(await screen.findByText('common.superAssistant.startChat'));
    await waitFor(() => expect(hooks.error).toHaveBeenCalledWith('common.superAssistant.employeeUnavailable'));
  });

  it('renders nothing for a member with no distributed employees', async () => {
    hooks.list.mockResolvedValue([OWN_EMPLOYEE]);
    const { container } = renderGrid();
    await waitFor(() => expect(hooks.list).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="enterprise-employee-grid"]')).toBeNull();
  });
});
