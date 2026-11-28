/**
 * Copyright 2026 One Work
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  listProviders: vi.fn(),
  checkProviderHealth: vi.fn(),
  prefs: new Map<string, unknown>(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: { listProviders: { invoke: mocks.listProviders } },
    acpConversation: { checkProviderHealth: { invoke: mocks.checkProviderHealth } },
  },
}));
vi.mock('@/common/adapter/ipcBridge', () => {
  const api = { getConfig: { invoke: mocks.getConfig }, setConfig: { invoke: mocks.setConfig } };
  return { claudeBridge: api, codexBridge: api };
});
vi.mock('@/common/config/configService', () => ({
  configService: {
    get: (key: string) => mocks.prefs.get(key),
    set: async (key: string, value: unknown) => void mocks.prefs.set(key, value),
  },
}));
vi.mock('@/renderer/hooks/agent/useClaudeBridgeStatus', () => ({ CLAUDE_BRIDGE_STATUS_SWR_KEY: 'claude' }));
vi.mock('@/renderer/hooks/agent/useCodexBridgeStatus', () => ({ CODEX_BRIDGE_STATUS_SWR_KEY: 'codex' }));
vi.mock('swr', () => ({ mutate: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({
  Modal: { confirm: mocks.confirm },
  Message: { success: mocks.success, error: mocks.error },
}));

import { useBridgeModelPrompt } from '@/renderer/hooks/agent/bridge/useBridgeModelPrompt';

type Dialog = { onOk: () => unknown; onCancel: () => void };

const provider = (id: string) => ({ id, name: id, platform: 'anthropic', models: ['chat-a'] });

const offer = () => {
  const navigate = vi.fn();
  const { result } = renderHook(() => useBridgeModelPrompt({ navigate, t: ((key: string) => key) as never }));
  return { run: result.current, navigate };
};

/** Press a button of the dialog once it has been opened. */
const press = async (button: keyof Dialog) => {
  await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
  await (mocks.confirm.mock.calls[0][0] as Dialog)[button]();
};

describe('useBridgeModelPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prefs.clear();
    mocks.getConfig.mockResolvedValue({ enabled: false, provider_id: null, model: null });
    mocks.setConfig.mockImplementation(async (config: unknown) => config);
    mocks.listProviders.mockResolvedValue([provider('broken'), provider('working')]);
    mocks.checkProviderHealth.mockImplementation(async ({ provider_id }: { provider_id: string }) => ({
      status: provider_id === 'working' ? 'healthy' : 'unhealthy',
    }));
  });

  it('sets up the first model that answers once the user agrees', async () => {
    const outcome = offer().run('claude');
    await press('onOk');

    await expect(outcome).resolves.toBe('bridged');
    expect(mocks.setConfig).toHaveBeenCalledWith({ enabled: true, provider_id: 'working', model: 'chat-a' });
  });

  it('keeps the draft unsent when no model answers', async () => {
    mocks.checkProviderHealth.mockResolvedValue({ status: 'unhealthy' });

    const outcome = offer().run('claude');
    await press('onOk');

    await expect(outcome).resolves.toBe('stop');
    expect(mocks.setConfig).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
  });

  it('does not ask again after the user chooses their own account', async () => {
    const first = offer().run('codex');
    await press('onCancel');
    await expect(first).resolves.toBe('unchanged');
    mocks.confirm.mockClear();

    await expect(offer().run('codex')).resolves.toBe('unchanged');

    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('sends the user to add a model when none fits', async () => {
    mocks.listProviders.mockResolvedValue([]);
    const { run, navigate } = offer();

    const outcome = run('claude');
    await press('onOk');

    await expect(outcome).resolves.toBe('stop');
    expect(navigate).toHaveBeenCalledWith('/settings/model');
  });

  it.each([
    ['another agent', 'dream', { enabled: false, provider_id: null }],
    ['a bridge already on', 'claude', { enabled: true, provider_id: 'p' }],
    ['a bridge the user switched off', 'claude', { enabled: false, provider_id: 'p' }],
  ])('stays quiet for %s', async (_case, backend, config) => {
    mocks.getConfig.mockResolvedValue(config);

    await expect(offer().run(backend)).resolves.toBe('unchanged');

    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
