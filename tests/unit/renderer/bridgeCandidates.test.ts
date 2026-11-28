/**
 * Copyright 2026 One Work
 */

import { describe, expect, it } from 'vitest';

import type { IProvider } from '@/common/config/storage';
import { listBridgeCandidates } from '@/renderer/hooks/agent/bridge/bridgeCandidates';

const provider = (id: string, extra: Partial<IProvider> = {}): IProvider =>
  ({
    id,
    name: id,
    platform: 'custom',
    base_url: 'https://x',
    api_key: 'k',
    models: ['chat-a'],
    ...extra,
  }) as IProvider;

const ids = (list: ReturnType<typeof listBridgeCandidates>) => list.map(({ provider: p, model }) => `${p.id}/${model}`);

describe('listBridgeCandidates', () => {
  const providers = [
    provider('openai-like', { platform: 'openai', model_protocols: { 'chat-a': 'anthropic' } }),
    provider('compatible'),
    provider('native', { platform: 'anthropic' }),
    provider('per-model', {
      platform: 'new-api',
      models: ['chat-a', 'chat-b'],
      model_protocols: { 'chat-b': 'anthropic' },
    }),
    provider('full-url', { platform: 'anthropic', is_full_url: true }),
  ];

  it('offers Claude only endpoints that speak the Anthropic protocol', () => {
    expect(ids(listBridgeCandidates('claude', providers))).toEqual(['native/chat-a', 'per-model/chat-b']);
  });

  it('offers Codex every provider, one model each', () => {
    expect(ids(listBridgeCandidates('codex', providers))).toEqual([
      'openai-like/chat-a',
      'compatible/chat-a',
      'native/chat-a',
      'per-model/chat-a',
      'full-url/chat-a',
    ]);
  });

  it('puts the current chat model first', () => {
    const list = listBridgeCandidates('codex', providers, { providerId: 'per-model', model: 'chat-b' });

    expect(ids(list)[0]).toBe('per-model/chat-b');
  });

  it('skips disabled providers and disabled models', () => {
    const list = listBridgeCandidates('codex', [
      provider('off', { enabled: false }),
      provider('muted', { model_enabled: { 'chat-a': false } }),
    ]);

    expect(list).toEqual([]);
  });
});
