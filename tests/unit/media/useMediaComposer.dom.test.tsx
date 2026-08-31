/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The send box owns media-model selection now: a model declared as image/video
 * in Settings > Models is picked up automatically, and a pick made in the
 * conversation is remembered for the next one. These tests pin both — the
 * declared-model fallback and the write-back — without a real send box.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { IProvider } from '@/common/config/storage';

vi.mock('@/common', () => ({ ipcBridge: {} }));

const startMediaJob = vi.fn(() => Promise.resolve({ job: { id: 'j-1' } }));
vi.mock('@renderer/hooks/media/mediaJobsTransport', () => ({ startMediaJob: (i: unknown) => startMediaJob(i) }));

const persistMediaModelSelection = vi.fn(() => Promise.resolve());
vi.mock('@renderer/hooks/media/mediaModelSettings', () => ({
  persistMediaModelSelection: (...a: unknown[]) => persistMediaModelSelection(...a),
}));

const stored = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: (key: string) => Promise.resolve(stored.value[key]),
  setClientBusinessSetting: () => Promise.resolve(),
}));

const { useMediaComposer } = await import('@/renderer/hooks/media/useMediaComposer');
const { requestMediaMode } = await import('@/renderer/hooks/media/mediaModeStore');

const provider = (over: Partial<IProvider> & { id: string; models: string[] }): IProvider =>
  ({ name: over.id, platform: 'openai', base_url: 'https://api.openai.com/v1', api_key: 'k', ...over }) as IProvider;

const IMAGE = provider({ id: 'img', models: ['gpt-image-1'] });
const VIDEO = provider({ id: 'vid', models: ['doubao-seedance-1-0-pro'] });

afterEach(() => {
  vi.clearAllMocks();
  stored.value = {};
});

describe('useMediaComposer media models', () => {
  it('offers the declared models for the active kind and seeds the selection from them', async () => {
    const { result } = renderHook(() => useMediaComposer('c-1', [IMAGE, VIDEO]));

    await waitFor(() => expect(result.current.mode).toBe('off'));
    expect(result.current.models).toEqual([]);

    act(() => result.current.changeMode('image'));
    expect(result.current.models.map((m) => m.model)).toEqual(['gpt-image-1']);
    // Nothing picked in settings, so the send box starts on the declared model.
    await waitFor(() => expect(result.current.model).toBe('gpt-image-1'));

    act(() => result.current.changeMode('video'));
    expect(result.current.models.map((m) => m.model)).toEqual(['doubao-seedance-1-0-pro']);
  });

  it('remembers a send-box pick by writing it back to the global setting', async () => {
    const { result } = renderHook(() => useMediaComposer('c-1', [IMAGE]));
    act(() => result.current.changeMode('image'));
    await waitFor(() => expect(result.current.model).toBe('gpt-image-1'));

    act(() => result.current.chooseModel('img', 'gpt-image-1'));
    expect(persistMediaModelSelection).toHaveBeenCalledWith(
      'image',
      expect.objectContaining({ id: 'img', use_model: 'gpt-image-1' })
    );
  });

  it('also persists a model chosen from the header dropdown (requestMediaMode)', async () => {
    const { result } = renderHook(() => useMediaComposer('c-2', [VIDEO]));
    await waitFor(() => expect(result.current.mode).toBe('off'));

    act(() => requestMediaMode('c-2', 'video', { providerId: 'vid', model: 'doubao-seedance-1-0-pro' }));

    await waitFor(() => expect(result.current.mode).toBe('video'));
    expect(result.current.model).toBe('doubao-seedance-1-0-pro');
    expect(persistMediaModelSelection).toHaveBeenCalledWith(
      'video',
      expect.objectContaining({ id: 'vid', use_model: 'doubao-seedance-1-0-pro' })
    );
  });

  it('exposes no models and no picker while in chat mode', async () => {
    const { result } = renderHook(() => useMediaComposer('c-1', [IMAGE]));
    await waitFor(() => expect(result.current.mode).toBe('off'));
    expect(result.current.models).toEqual([]);
  });
});
