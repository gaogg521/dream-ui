/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), reset: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: { personalAgent: { create: { invoke: hooks.create }, update: { invoke: hooks.update } } },
}));
vi.mock('@/common/adapter/enterpriseMode', () => ({ isEnterpriseRemoteActive: () => false }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  // Arco's toast renders through an API React 19 removed; the toast is not what is tested.
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('@renderer/pages/superAssistant/hooks/useEmployeeAgentBinding', () => ({
  useEmployeeAgentBinding: () => ({
    reset: hooks.reset,
    buildBinding: () => ({ agentType: 'dream', model: { id: 'p', use_model: 'm' } }),
    resolvedBackend: 'dream',
  }),
}));
vi.mock('@renderer/pages/superAssistant/components/EmployeeBindingFields', () => ({
  default: () => <div>binding-fields</div>,
}));

// Arco's Modal and Form read media queries, which jsdom does not have.
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList);

import CreateAgentModal from '@/renderer/pages/superAssistant/components/CreateAgentModal';
import ManageAgentModal from '@/renderer/pages/superAssistant/components/ManageAgentModal';
import { resolveEmployeeAvatar } from '@/renderer/pages/superAssistant/utils/employeeAvatar';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';

const SEED = {
  name: '热点话题调研员',
  description: '跨站点调研任意话题',
  instructions: '你是调研员。',
  starterPrompts: ['调研一下 AI 眼镜'],
};

describe('CreateAgentModal from a template', () => {
  beforeEach(() => {
    hooks.create.mockReset().mockResolvedValue({});
    hooks.reset.mockReset();
  });

  it('opens filled in from the template, every part editable, and creates nothing until confirmed', async () => {
    render(<CreateAgentModal visible seed={SEED} onClose={vi.fn()} onCreated={vi.fn()} />);
    const name = (await screen.findByDisplayValue('热点话题调研员')) as HTMLInputElement;
    expect(screen.getByDisplayValue('跨站点调研任意话题')).toBeInTheDocument();
    expect(screen.getByDisplayValue('你是调研员。')).toBeInTheDocument();
    expect(hooks.create).not.toHaveBeenCalled();

    fireEvent.change(name, { target: { value: '我的调研员' } });
    expect(name.value).toBe('我的调研员');
  });

  it('creates the employee with the edited fields and the template example tasks, bound to the chosen model', async () => {
    const onCreated = vi.fn();
    render(<CreateAgentModal visible seed={SEED} onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.change(await screen.findByDisplayValue('热点话题调研员'), { target: { value: '我的调研员' } });
    fireEvent.click(screen.getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(hooks.create).toHaveBeenCalledTimes(1));
    expect(hooks.create.mock.calls[0][0]).toMatchObject({
      name: '我的调研员',
      agentType: 'dream',
      automationConfig: { instructions: '你是调研员。', starterPrompts: ['调研一下 AI 眼镜'] },
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('is an empty form without a template', async () => {
    render(<CreateAgentModal visible onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByText('binding-fields');
    expect(screen.queryByDisplayValue('热点话题调研员')).not.toBeInTheDocument();
  });

  it('creates an employee with a portrait from the shared scene library', async () => {
    render(<CreateAgentModal visible seed={SEED} onClose={vi.fn()} onCreated={vi.fn()} />);
    const gallery = screen.getByRole('group', { name: 'settings.assistantAvatarBuiltinTab' });
    const portraits = within(gallery).getAllByRole('button');
    expect(portraits).toHaveLength(22);
    fireEvent.click(portraits[19]);
    expect(screen.getByTestId('employee-avatar-preview').getAttribute('src')).toMatch(/\/costume\/tang\.png$/);
    fireEvent.click(screen.getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(hooks.create).toHaveBeenCalledTimes(1));
    const { automationConfig } = hooks.create.mock.calls[0][0];
    expect(automationConfig.avatarPreset).toBe('av-tang');
    expect(resolveEmployeeAvatar({ id: 'new', automationConfig })).toMatch(/\/costume\/tang\.png$/);
  });
});

describe('ManageAgentModal avatar', () => {
  const agent: PersonalAgent = {
    id: 'employee-1',
    ownerUserId: 'local',
    tenantId: 'default',
    name: '研究员',
    agentType: 'dream',
    automationConfig: { avatarPreset: 'av-tang', starterPrompts: ['调研一下'] },
    visibility: 'private',
    scheduleEnabled: false,
    createdAt: 0,
    updatedAt: 0,
  };

  beforeEach(() => {
    hooks.update.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('replaces the preset with an uploaded image and preserves other employee settings', async () => {
    const avatarUrl = 'data:image/png;base64,avatar';
    const drawImage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 320, height: 256, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(avatarUrl);

    const { container } = render(<ManageAgentModal visible agent={agent} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('employee-avatar-preview').getAttribute('src')).toMatch(/\/costume\/tang\.png$/);
    const input =
      screen.getByRole('dialog').querySelector('input[type=file]') ?? container.querySelector('input[type=file]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByTestId('employee-avatar-preview')).toHaveAttribute('src', avatarUrl));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 32, 0, 256, 256, 0, 0, 256, 256);
    expect(close).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(hooks.update).toHaveBeenCalledTimes(1));
    const { automationConfig } = hooks.update.mock.calls[0][0].updates;
    expect(automationConfig).toMatchObject({ avatarUrl, starterPrompts: ['调研一下'] });
    expect(automationConfig.avatarPreset).toBeUndefined();
    expect(resolveEmployeeAvatar({ id: agent.id, automationConfig })).toBe(avatarUrl);
  });

  it('restores the default portrait when saved', async () => {
    render(<ManageAgentModal visible agent={agent} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.default' }));
    fireEvent.click(screen.getByRole('button', { name: /确定|OK/ }));
    await waitFor(() => expect(hooks.update).toHaveBeenCalledTimes(1));
    const { automationConfig } = hooks.update.mock.calls[0][0].updates;
    expect(automationConfig.avatarPreset).toBeUndefined();
    expect(automationConfig.avatarUrl).toBeUndefined();
    expect(resolveEmployeeAvatar({ id: agent.id, automationConfig })).toBe(resolveEmployeeAvatar({ id: agent.id }));
  });
});
