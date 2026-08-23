/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The welcome page must never sit there naming a model that cannot chat.
 *
 * Reported from a real screenshot: the model pill read `seedance-2-0-fast` — a
 * video endpoint — on a page whose only action is to start a conversation, so
 * there was no way to tell whether pressing Enter would talk or generate, and
 * the answer was neither: a chat request to that model returns
 * `404 model not found`.
 *
 * The cause was a split between two lists. The picker had already been narrowed
 * to chat-capable models, but the *selection* logic still consulted the raw
 * `provider.models`, so a stale pick survived and even the fallback could land
 * on one. What is selected and what is offered have to come from one list.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { IProvider } from '@/common/config/storage';

const providers = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: providers.value }),
}));
vi.mock('@/renderer/hooks/agent/useGoogleAuthModels', () => ({
  useGoogleAuthModels: () => ({ isGoogleAuth: false }),
}));

const { useGuidModelSelection } = await import('@/renderer/pages/guid/hooks/useGuidModelSelection');

/** A provider listing a video endpoint FIRST, then a real chat model. */
const provider = (over: Partial<IProvider> = {}): unknown => ({
  id: 'p-1',
  name: 'openai',
  platform: 'custom',
  base_url: 'https://gw.example.com',
  api_key: 'k',
  models: ['seedance-2-0-fast', 'kimi-k2-6'],
  model_settings: { 'seedance-2-0-fast': { model_kind: 'video' } },
  ...over,
});

describe('useGuidModelSelection', () => {
  it('never defaults to a model that cannot hold a conversation', async () => {
    providers.value = [provider()];
    const { result } = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(result.current.current_model?.use_model).toBeTruthy());
    // `models[0]` is the video endpoint; the chat-capable one must win.
    expect(result.current.current_model?.use_model).toBe('kimi-k2-6');
  });

  it('replaces a stale selection of a now-declared video model', async () => {
    providers.value = [provider()];
    const { result } = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(result.current.current_model?.use_model).toBeTruthy());

    await result.current.setCurrentModel({ ...(provider() as IProvider), use_model: 'seedance-2-0-fast' });
    await waitFor(() => expect(result.current.current_model?.use_model).toBe('kimi-k2-6'));
  });

  it('keeps a selection that is still chat-capable', async () => {
    providers.value = [provider({ models: ['kimi-k2-6', 'glm-5-2'] })];
    const { result } = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(result.current.current_model?.use_model).toBeTruthy());

    await result.current.setCurrentModel({ ...(provider() as IProvider), use_model: 'glm-5-2' });
    await waitFor(() => expect(result.current.current_model?.use_model).toBe('glm-5-2'));
  });

  it('selects nothing when the provider offers no chat model at all', async () => {
    providers.value = [
      provider({
        models: ['seedance-2-0-fast'],
        model_settings: { 'seedance-2-0-fast': { model_kind: 'video' } },
      }),
    ];
    const { result } = renderHook(() => useGuidModelSelection());
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.current_model).toBeUndefined();
  });
});
