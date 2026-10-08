/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IProvider, TChatConversation, TProviderWithModel } from '@/common/config/storage';
import {
  isSavedModelStale,
  pickFallbackModel,
} from '@/renderer/pages/conversation/platforms/dreamEngine/staleModelFallback';

const provider = (id: string, models: string[]) =>
  ({ id, name: id, platform: 'custom', models }) as unknown as IProvider;
const saved = (id: string, use_model: string) => ({ id, use_model }) as TProviderWithModel;
const conversation = (id: string, model: TProviderWithModel, modified_at: number, type = 'dream') =>
  ({ id, type, model, modified_at }) as unknown as TChatConversation;

// Mirrors the picker: image models are not chat-capable.
const getAvailableModels = (p: IProvider) => (p.models ?? []).filter((m) => !m.includes('image'));

describe('isSavedModelStale', () => {
  const providers = [provider('p1', ['deepseek-v4', 'gpt-image-2'])];

  it('flags a deleted provider and a model removed from its provider', () => {
    expect(isSavedModelStale(saved('gone', 'deepseek-v4'), providers)).toBe(true);
    expect(isSavedModelStale(saved('p1', 'removed-model'), providers)).toBe(true);
  });

  it('leaves working bindings and conversations without a model alone', () => {
    expect(isSavedModelStale(saved('p1', 'deepseek-v4'), providers)).toBe(false);
    expect(isSavedModelStale(undefined, providers)).toBe(false);
  });
});

describe('pickFallbackModel', () => {
  const providers = [provider('a', ['gpt-image-2', 'qwen-flash']), provider('b', ['deepseek-v4', 'glm-5'])];
  const base = { providers, getAvailableModels, conversationId: 'this' };

  it('keeps the same model when another provider still offers it', () => {
    const pick = pickFallbackModel({ ...base, staleModel: saved('gone', 'deepseek-v4'), recentConversations: [] });
    expect([pick?.id, pick?.use_model]).toEqual(['b', 'deepseek-v4']);
  });

  it('otherwise continues with the model of the most recently used conversation', () => {
    const recentConversations = [
      conversation('older', saved('a', 'qwen-flash'), 100),
      conversation('newest-broken', saved('gone', 'x'), 300),
      conversation('newer', saved('b', 'glm-5'), 200),
      conversation('this', saved('gone', 'old-model'), 999),
      conversation('acp', saved('a', 'qwen-flash'), 500, 'acp'),
    ];
    const pick = pickFallbackModel({ ...base, staleModel: saved('gone', 'old-model'), recentConversations });
    expect([pick?.id, pick?.use_model]).toEqual(['b', 'glm-5']);
  });

  it('falls back to the first chat-capable model, never an image model', () => {
    const pick = pickFallbackModel({ ...base, staleModel: saved('gone', 'old-model'), recentConversations: [] });
    expect([pick?.id, pick?.use_model]).toEqual(['a', 'qwen-flash']);
  });

  it('returns nothing when no chat model is configured at all', () => {
    expect(
      pickFallbackModel({
        ...base,
        providers: [],
        staleModel: saved('gone', 'old-model'),
        recentConversations: [],
      })
    ).toBeUndefined();
  });
});
