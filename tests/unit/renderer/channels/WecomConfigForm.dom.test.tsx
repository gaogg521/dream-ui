import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';
import WecomConfigForm from '@/renderer/components/settings/SettingsModal/contents/channels/WecomConfigForm';

const mocks = vi.hoisted(() => ({
  enable: vi.fn(),
  changed: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key, i18n: { language: 'en-US' } }),
}));
vi.mock('@/common/adapter/ipcBridge', () => ({
  assistants: { list: { invoke: async () => [] } },
  channel: {
    enablePlugin: { invoke: mocks.enable },
    getPluginStatus: { invoke: async () => [{ type: 'wecom', enabled: true, connected: true }] },
    getPendingPairings: { invoke: async () => [] },
    getAuthorizedUsers: { invoke: async () => [] },
    getPlatformSettings: { invoke: async () => ({ assistant: null }) },
    pairingRequested: { on: () => () => {} },
    userAuthorized: { on: () => () => {} },
  },
}));
vi.mock('@arco-design/web-react', async (original) => ({
  ...(await original<typeof import('@arco-design/web-react')>()),
  Message: { warning: mocks.warning, success: mocks.success, error: mocks.error },
}));
vi.mock('@/renderer/pages/conversation/platforms/gemini/GoogleModelSelector', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/channels/ManualPairingInput', () => ({
  default: () => null,
}));

const modelSelection = {} as GoogleModelSelection;
function show() {
  render(<WecomConfigForm pluginStatus={null} modelSelection={modelSelection} onStatusChange={mocks.changed} />);
}
function fill() {
  fireEvent.change(screen.getByLabelText('Bot ID'), { target: { value: 'fixture-bot' } });
  fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 'fixture-secret' } });
}

describe('WeCom WebSocket configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enable.mockResolvedValue(undefined);
  });

  it('requires both long-connection credentials before enabling', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Enable' }));
    expect(mocks.enable).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith('Please enter Bot ID and Secret');
  });

  it('sends the credential fields that the actual Core plugin reads', async () => {
    show();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Enable' }));
    await waitFor(() =>
      expect(mocks.enable).toHaveBeenCalledWith({
        plugin_id: 'wecom',
        config: { credentials: { app_id: 'fixture-bot', app_secret: 'fixture-secret' } },
      })
    );
    await waitFor(() => expect(mocks.changed).toHaveBeenCalledWith(expect.objectContaining({ connected: true })));
  });

  it('keeps entered credentials available to retry after a connection failure', async () => {
    mocks.enable.mockRejectedValue(new Error('Connection refused'));
    show();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Enable' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Connection refused'));
    expect(screen.getByLabelText('Secret')).toHaveValue('fixture-secret');
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
