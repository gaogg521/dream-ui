/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { IProvider } from '@/common/config/storage';

const { listProvidersMock, updateProviderMock } = vi.hoisted(() => ({
  listProvidersMock: vi.fn(),
  updateProviderMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    mode: {
      listProviders: { invoke: listProvidersMock },
      updateProvider: { invoke: updateProviderMock },
    },
  },
}));

import { useAutoAcceptInferredModelKinds } from '@/renderer/hooks/agent/useAutoAcceptInferredModelKinds';

const createWrapper = () => {
  const cache = new Map();
  return ({ children }: { children: React.ReactNode }) => (
    <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
  );
};

const baseProvider = (over: Partial<IProvider>): IProvider =>
  ({
    id: 'agnes',
    name: 'Agnes',
    platform: 'custom',
    base_url: 'https://apihub.agnes-ai.com',
    api_key: 'sk-test',
    models: ['agnes-2.5-flash', 'agnes-image-2.0-flash', 'agnes-video-v2.0'],
    ...over,
  }) as IProvider;

describe('useAutoAcceptInferredModelKinds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProviderMock.mockResolvedValue(undefined);
  });

  it('declares every inferred model kind without the user clicking anything', async () => {
    const provider = baseProvider({});
    listProvidersMock.mockResolvedValue([provider]);

    renderHook(() => useAutoAcceptInferredModelKinds(true), { wrapper: createWrapper() });

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledTimes(1));

    const call = updateProviderMock.mock.calls[0][0] as { id: string; model_settings?: Record<string, unknown> };
    expect(call.id).toBe('agnes');
    // Guessed purely from the model name — image/video patterns, text default.
    expect(call.model_settings).toMatchObject({
      'agnes-image-2.0-flash': { model_kind: 'image' },
      'agnes-video-v2.0': { model_kind: 'video' },
      'agnes-2.5-flash': { model_kind: 'text' },
    });
  });

  it('does not touch a provider whose kinds are already declared', async () => {
    const provider = baseProvider({
      model_settings: {
        'agnes-image-2.0-flash': { model_kind: 'image' },
        'agnes-video-v2.0': { model_kind: 'video' },
        'agnes-2.5-flash': { model_kind: 'text' },
      },
    });
    listProvidersMock.mockResolvedValue([provider]);

    renderHook(() => useAutoAcceptInferredModelKinds(true), { wrapper: createWrapper() });

    await waitFor(() => expect(listProvidersMock).toHaveBeenCalled());
    // Give any stray async write a chance to happen before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updateProviderMock).not.toHaveBeenCalled();
  });

  // A company-provisioned channel gets overwritten by the next sync anyway —
  // writing to it here would only produce a change that silently reverts,
  // same reasoning as the manual "accept" button's own exclusion.
  it('skips enterprise-managed providers', async () => {
    const provider = baseProvider({ managed_by: 'enterprise' });
    listProvidersMock.mockResolvedValue([provider]);

    renderHook(() => useAutoAcceptInferredModelKinds(true), { wrapper: createWrapper() });

    await waitFor(() => expect(listProvidersMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(updateProviderMock).not.toHaveBeenCalled();
  });

  it('does not fetch anything before the app is ready', async () => {
    listProvidersMock.mockResolvedValue([baseProvider({})]);

    renderHook(() => useAutoAcceptInferredModelKinds(false), { wrapper: createWrapper() });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listProvidersMock).not.toHaveBeenCalled();
    expect(updateProviderMock).not.toHaveBeenCalled();
  });
});
