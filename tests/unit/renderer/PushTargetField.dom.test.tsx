/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ targets: [] as unknown[], navigate: vi.fn() }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate, useInRouterContext: () => true }));
vi.mock('@/common', () => ({
  ipcBridge: { channel: { getPushTargets: { invoke: vi.fn(async () => mocks.targets) } } },
}));

import PushTargetField, { buildPushOptions } from '@/renderer/pages/cron/ScheduledTasksPage/PushTargetField';

const lark = {
  pluginId: 'lark',
  type: 'lark',
  name: '飞书机器人',
  connected: true,
  chats: [{ chatId: 'oc_1', displayName: '小王' }, { chatId: 'oc_2' }],
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('buildPushOptions', () => {
  it('makes one option per chat, labelled with the bot and the person (or the raw chat id)', () => {
    expect(buildPushOptions([lark, { ...lark, pluginId: 'tg', name: 'Telegram', chats: [] }])).toEqual([
      { key: 'lark::oc_1', label: '飞书机器人 · 小王', target: { plugin_id: 'lark', chat_id: 'oc_1' } },
      { key: 'lark::oc_2', label: '飞书机器人 · oc_2', target: { plugin_id: 'lark', chat_id: 'oc_2' } },
    ]);
  });
});

describe('PushTargetField', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
  });

  it('starts off, follows a seeded target, and turning it off clears the target', async () => {
    mocks.targets = [lark];
    const onChange = vi.fn();
    const { rerender } = render(<PushTargetField value={null} onChange={onChange} />);
    expect(screen.getByTestId('push-target-switch')).toHaveAttribute('aria-checked', 'false');

    rerender(<PushTargetField value={{ plugin_id: 'lark', chat_id: 'oc_1' }} onChange={onChange} />);
    await waitFor(() => expect(screen.getByTestId('push-target-switch')).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByTestId('push-target-switch'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('picks the only chat for the person when it is switched on', async () => {
    mocks.targets = [{ ...lark, chats: [{ chatId: 'oc_1', displayName: '小王' }] }];
    const onChange = vi.fn();
    render(<PushTargetField value={null} onChange={onChange} />);
    await settle();
    fireEvent.click(screen.getByTestId('push-target-switch'));
    expect(onChange).toHaveBeenCalledWith({ plugin_id: 'lark', chat_id: 'oc_1' });
  });

  it('tells the person to connect a bot when there is none, and to message it when it has no chats', async () => {
    mocks.targets = [];
    const first = render(<PushTargetField value={null} onChange={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByTestId('push-target-switch'));
    expect(await screen.findByText('cron.page.form.push.noBot')).toBeInTheDocument();
    fireEvent.click(screen.getByText('cron.page.form.push.goSettings'));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/webui');
    first.unmount();

    mocks.targets = [{ ...lark, chats: [] }];
    render(<PushTargetField value={null} onChange={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByTestId('push-target-switch'));
    expect(await screen.findByText('cron.page.form.push.noChat')).toBeInTheDocument();
  });
});
