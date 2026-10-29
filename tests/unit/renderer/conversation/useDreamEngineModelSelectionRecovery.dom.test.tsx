/** @vitest-environment jsdom */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cached: [] as unknown[],
  fresh: [] as unknown[],
  fetchProviders: vi.fn(),
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  fetchProviders: hooks.fetchProviders,
  useProvidersQuery: () => ({ data: hooks.cached }),
  useModelProviderList: () => ({
    providers: hooks.cached,
    getAvailableModels: (provider: { models?: string[] }) => provider.models ?? [],
    formatModelLabel: (_model: unknown, name: string) => name,
  }),
}));

import { useDreamEngineModelSelection } from '@/renderer/pages/conversation/platforms/dreamEngine/useDreamEngineModelSelection';

const personal = { id: 'personal', name: 'openai', platform: 'openai', models: ['glm-flash-latest'] };
const delivered = { id: 'prov_chan_x', name: 'openai', platform: 'openai', models: ['deepseek-flash-latest'] };
const saved = { id: 'prov_chan_x', use_model: 'deepseek-flash-latest' } as never;

const mount = (extra: { recoveryPaused?: boolean } = {}) => {
  const onSelectModel = vi.fn().mockResolvedValue(true);
  renderHook(() =>
    useDreamEngineModelSelection({ initialModel: saved, onSelectModel, conversationId: 'c1', ...extra })
  );
  return onSelectModel;
};

describe('stale saved-model recovery', () => {
  beforeEach(() => {
    hooks.cached = [personal];
    hooks.fresh = [personal, delivered];
    hooks.fetchProviders.mockReset().mockImplementation(async () => hooks.fresh);
  });

  it('leaves the conversation alone when the cached list is only out of date', async () => {
    const onSelectModel = mount();
    await waitFor(() => expect(hooks.fetchProviders).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it('moves on to another model only when a fresh read also lacks the saved one', async () => {
    hooks.fresh = [personal];
    const onSelectModel = mount();
    await waitFor(() => expect(onSelectModel).toHaveBeenCalledTimes(1));
    expect(onSelectModel.mock.calls[0][1]).toBe('glm-flash-latest');
  });

  it('never swaps the model while a turn is running', async () => {
    hooks.fresh = [personal];
    const onSelectModel = mount({ recoveryPaused: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hooks.fetchProviders).not.toHaveBeenCalled();
    expect(onSelectModel).not.toHaveBeenCalled();
  });

  it('keeps the model when the fresh read itself fails', async () => {
    hooks.fetchProviders.mockRejectedValue(new Error('offline'));
    const onSelectModel = mount();
    await waitFor(() => expect(hooks.fetchProviders).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onSelectModel).not.toHaveBeenCalled();
  });
});
