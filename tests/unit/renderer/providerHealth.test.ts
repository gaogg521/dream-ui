import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';

const { probe, list, update } = vi.hoisted(() => ({ probe: vi.fn(), list: vi.fn(), update: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { checkProviderHealth: { invoke: probe } },
    mode: { listProviders: { invoke: list }, updateProvider: { invoke: update } },
  },
}));

import { probeModelHealth } from '@/renderer/utils/model/providerHealth';

const provider = { id: 'prov_chan_maas', models: ['glm'] } as IProvider;

describe('model health checks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(['healthy', 'unhealthy', 'request failed'])(
    'reports %s for a managed model without writing provider config',
    async (status) => {
      if (status === 'request failed') probe.mockRejectedValue(new Error(status));
      else probe.mockResolvedValue({ status, elapsed_ms: 14, message: 'upstream failure' });
      const report = vi.fn();

      await probeModelHealth({ ...provider, managed_by: 'enterprise' }, 'glm', report, () => true, 'unknown');

      expect(probe).toHaveBeenCalledExactlyOnceWith({ provider_id: provider.id, model: 'glm' });
      expect(report).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: status === 'healthy' ? 'healthy' : 'unhealthy' })
      );
      expect(list).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  );

  it('merges personal health results into the latest provider state', async () => {
    const personal = { ...provider, id: 'personal' };
    const other = { status: 'healthy', latency: 12, last_check: 1 };
    probe.mockResolvedValue({ status: 'healthy', elapsed_ms: 0 });
    list.mockResolvedValue([{ ...personal, model_health: { other } }]);
    const report = vi.fn();
    await probeModelHealth(personal, 'glm', report, () => true, 'unknown');
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: 'personal',
      model_health: { other, glm: expect.objectContaining({ status: 'healthy', latency: 0 }) },
    });
  });

  it('drops a probe result after changing the active connection', async () => {
    probe.mockResolvedValue({ status: 'healthy' });
    const report = vi.fn();
    await probeModelHealth(provider, 'glm', report, () => false, 'unknown');
    expect(report).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
