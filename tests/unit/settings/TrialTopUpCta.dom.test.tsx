/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const providers = vi.hoisted(() => ({ data: [{ id: 'trial-baoyun' }] as unknown }));
const quota = vi.hoisted(() => ({
  data: {
    kind: 'issued' as const,
    vendor: 'baoyun' as const,
    data: {
      vendor: 'baoyun',
      limit_usd: 5,
      used_usd: 5,
      remaining_usd: 0,
      reset: null,
      exhausted: true,
      currency: 'CNY',
    },
  } as unknown,
}));

vi.mock('@renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: providers.data }),
}));

vi.mock('@renderer/hooks/agent/useTrialQuota', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/hooks/agent/useTrialQuota')>();
  return { ...actual, useTrialQuota: () => ({ data: quota.data }) };
});

vi.mock('@/renderer/pages/settings/components/TrialTopUpModal', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid='trial-top-up-modal' /> : null),
}));

import TrialTopUpCta from '@/renderer/pages/conversation/Messages/components/TrialTopUpCta';

afterEach(() => {
  cleanup();
  providers.data = [{ id: 'trial-baoyun' }];
  quota.data = {
    kind: 'issued',
    vendor: 'baoyun',
    data: {
      vendor: 'baoyun',
      limit_usd: 5,
      used_usd: 5,
      remaining_usd: 0,
      reset: null,
      exhausted: true,
      currency: 'CNY',
    },
  } as unknown;
});

describe('TrialTopUpCta', () => {
  it('offers recharge and opens the Mode A top-up modal for an exhausted Baoyun key', () => {
    render(<TrialTopUpCta />);

    const cta = screen.getByRole('button', { name: 'conversation.meteredTopUp.cta' });
    fireEvent.click(cta);

    expect(screen.getByTestId('trial-top-up-modal')).toBeTruthy();
  });

  it('does not offer recharge while the issued Baoyun key still has balance', () => {
    quota.data = {
      kind: 'issued',
      vendor: 'baoyun',
      data: {
        vendor: 'baoyun',
        limit_usd: 5,
        used_usd: 1,
        remaining_usd: 4,
        reset: null,
        exhausted: false,
        currency: 'CNY',
      },
    } as unknown;

    render(<TrialTopUpCta />);

    expect(screen.queryByRole('button', { name: 'conversation.meteredTopUp.cta' })).toBeNull();
  });

  it('does not offer recharge for a quota error when this install has no Baoyun key', () => {
    providers.data = [];
    render(<TrialTopUpCta />);

    expect(screen.queryByRole('button', { name: 'conversation.meteredTopUp.cta' })).toBeNull();
  });
});
