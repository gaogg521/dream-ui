/**
 * @license
 * Copyright 2026 One Work
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('useGuidModelSelection default', () => {
  const personal = provider({ id: 'personal', models: ['my-personal-model'], model_settings: {} });
  const trial = provider({ id: 'trial', models: ['openrouter/free'], model_settings: {} });

  beforeEach(() => {
    localStorage.clear();
  });

  it('follows the list as the providers finish loading, instead of freezing on whichever came first', async () => {
    // The first load can hold only some of the providers.
    providers.value = [trial];
    const { result, rerender } = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(result.current.current_model?.use_model).toBe('openrouter/free'));

    providers.value = [personal, trial];
    rerender();
    await waitFor(() => expect(result.current.current_model?.use_model).toBe('my-personal-model'));
  });

  it('starts every mount on the same model: the one last picked by hand, if it is still offered', async () => {
    providers.value = [personal, trial];
    const first = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(first.result.current.current_model?.use_model).toBe('my-personal-model'));
    await first.result.current.setCurrentModel(
      { ...(trial as IProvider), use_model: 'openrouter/free' },
      { persistPreference: true }
    );
    first.unmount();

    const second = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(second.result.current.current_model?.use_model).toBe('openrouter/free'));
    second.unmount();

    // Once that model is gone the default falls back to the first offered one.
    providers.value = [personal];
    const third = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(third.result.current.current_model?.use_model).toBe('my-personal-model'));
  });

  it('does not move a hand pick when the list changes, and does not remember an assistant default', async () => {
    providers.value = [personal, trial];
    const { result, rerender } = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(result.current.current_model?.use_model).toBe('my-personal-model'));

    // An assistant's own default: applied, but not written down as the person's choice.
    await result.current.setCurrentModel(
      { ...(trial as IProvider), use_model: 'openrouter/free' },
      { persistPreference: false }
    );
    expect(localStorage.getItem('guid.lastPickedModelKey')).toBeNull();

    providers.value = [{ ...(personal as object) } as IProvider, trial as IProvider];
    rerender();
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.current_model?.use_model).toBe('openrouter/free');
  });
});
