import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';
import DingTalkConfigForm from '@/renderer/components/settings/SettingsModal/contents/channels/DingTalkConfigForm';

const mocks = vi.hoisted(() => ({
  test: vi.fn(),
  enable: vi.fn(),
  changed: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key, i18n: { language: 'en-US' } }),
}));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  assistants: { list: { invoke: async () => [] } },
  channel: {
    testPlugin: { invoke: mocks.test },
    enablePlugin: { invoke: mocks.enable },
    getPluginStatus: { invoke: async () => [{ type: 'dingtalk', enabled: true, connected: true }] },
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
  render(<DingTalkConfigForm pluginStatus={null} modelSelection={modelSelection} onStatusChange={mocks.changed} />);
}

describe('DingTalk bot configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.test.mockResolvedValue({ success: true });
    mocks.enable.mockResolvedValue(undefined);
    // The real openExternalUrl returns a promise that the form chains `.catch` onto.
    mocks.openExternalUrl.mockResolvedValue(undefined);
  });

  it('links the credential hints to the DingTalk developer console', () => {
    show();
    const links = screen.getAllByRole('link', { name: 'DingTalk Developer Console' });
    // One next to Client ID, one next to Client Secret.
    expect(links).toHaveLength(2);
    fireEvent.click(links[0]);
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://open-dev.dingtalk.com');
  });

  it('requires both credentials before testing', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));
    expect(mocks.test).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith('Please enter Client ID and Client Secret');
  });

  it('tests with the Client ID in the token field, then enables with the real credential keys', async () => {
    show();
    fireEvent.change(screen.getByPlaceholderText('dingxxxxxxxxxx'), { target: { value: 'ding-fixture' } });
    fireEvent.change(screen.getByPlaceholderText('xxxxxxxxxxxxxxxxxx'), { target: { value: 'secret-fixture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test & Connect' }));

    await waitFor(() =>
      expect(mocks.test).toHaveBeenCalledWith({
        plugin_id: 'dingtalk',
        token: 'ding-fixture',
        extra_config: { app_secret: 'secret-fixture' },
      })
    );
    await waitFor(() =>
      expect(mocks.enable).toHaveBeenCalledWith({
        plugin_id: 'dingtalk',
        config: { credentials: { client_id: 'ding-fixture', client_secret: 'secret-fixture' } },
      })
    );
  });
});
