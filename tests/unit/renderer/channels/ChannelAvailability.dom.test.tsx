import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelConfig } from '@/renderer/components/settings/SettingsModal/contents/channels/types';
import ChannelModalContent from '@/renderer/components/settings/SettingsModal/contents/channels/ChannelModalContent';

const mocks = vi.hoisted(() => ({ enable: vi.fn(), warning: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : (fallback?.defaultValue ?? key),
  }),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  webui: { getStatus: { invoke: async () => null } },
  channel: {
    getPluginStatus: { invoke: async () => [] },
    enablePlugin: { invoke: mocks.enable },
    pluginStatusChanged: { on: () => () => {} },
  },
}));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({ useModelProviderList: () => ({ providers: [] }) }));
vi.mock('@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection', () => ({
  useGoogleModelSelection: () => ({}),
}));
vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));
vi.mock('@/renderer/components/base/DreamScrollArea', () => ({
  default: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@arco-design/web-react', async (original) => ({
  ...(await original<typeof import('@arco-design/web-react')>()),
  Message: { warning: mocks.warning },
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/ChannelItem', () => ({
  default: ({
    channel,
    isCollapsed,
    onToggleCollapse,
    onToggleEnabled,
  }: {
    channel: ChannelConfig;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    onToggleEnabled: (next: boolean) => void;
  }) => (
    <div data-testid={`channel-${channel.id}`} data-status={channel.status}>
      <button onClick={onToggleCollapse}>{`expand-${channel.id}`}</button>
      <button disabled={channel.disabled} onClick={() => onToggleEnabled(true)}>{`enable-${channel.id}`}</button>
      {!isCollapsed && channel.content}
    </div>
  ),
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/WecomConfigForm', () => ({
  default: () => <div>WeCom credential form</div>,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/DingTalkConfigForm', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/DiscordConfigForm', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/LarkConfigForm', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/SlackConfigForm', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/TelegramConfigForm', () => ({
  default: () => null,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/WeixinConfigForm', () => ({
  default: () => null,
}));

describe('WeCom channel availability', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the actual configuration entry rather than a coming-soon placeholder', async () => {
    render(<ChannelModalContent />);
    expect(screen.getByTestId('channel-wecom')).toHaveAttribute('data-status', 'active');
    fireEvent.click(screen.getByRole('button', { name: 'expand-wecom' }));
    expect(screen.getByText('WeCom credential form')).toBeVisible();
  });

  it('requires saved Bot ID and Secret before enabling from the channel header', async () => {
    render(<ChannelModalContent />);
    fireEvent.click(screen.getByRole('button', { name: 'enable-wecom' }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalledWith('Please save Bot ID and Secret first'));
    expect(mocks.enable).not.toHaveBeenCalled();
  });
});
