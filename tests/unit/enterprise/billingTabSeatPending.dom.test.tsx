/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * T6-4: a pending seat is a real person who cannot send a single message.
 * Silence here would look like the seat cap has no victims when it does —
 * these tests are about the warning that makes that visible to an admin.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  plan: vi.fn(),
  usage: vi.fn(),
  license: vi.fn(),
  listDepartments: vi.fn(),
  listDepartmentBudgets: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneBilling: {
      plan: { invoke: hooks.plan },
      usage: { invoke: hooks.usage },
      license: { invoke: hooks.license },
      listDepartmentBudgets: { invoke: hooks.listDepartmentBudgets },
    },
    oneAdmin: {
      listDepartments: { invoke: hooks.listDepartments },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}`,
  }),
}));

const BillingTab = (await import('@/renderer/pages/enterprise/components/BillingTab')).default;

const basePlan = {
  enterpriseId: 'ent1',
  tier: 'free',
  seatUsed: 3,
  seatLimit: 3,
  seatPending: 0,
  expiresAt: null,
  entitlements: [],
  costCapMicros: null,
  costUsedMicros: 0,
  allowedModels: [],
};

beforeEach(() => {
  hooks.plan.mockReset();
  hooks.usage.mockReset().mockResolvedValue(null);
  hooks.license.mockReset().mockResolvedValue(null);
  hooks.listDepartments.mockReset().mockResolvedValue([]);
  hooks.listDepartmentBudgets.mockReset().mockResolvedValue([]);
});

describe('BillingTab seat-pending warning', () => {
  it('warns when members are waiting on a seat', async () => {
    hooks.plan.mockResolvedValue({ ...basePlan, seatPending: 2 });
    render(<BillingTab />);

    await waitFor(() => expect(screen.getByText(/seatPendingWarning/)).toBeTruthy());
    expect(screen.getByText(/seatPendingWarning/).textContent).toContain('"count":2');
  });

  it('shows no warning when nobody is pending', async () => {
    hooks.plan.mockResolvedValue({ ...basePlan, seatPending: 0 });
    render(<BillingTab />);

    await waitFor(() => expect(screen.getByText(/billing.planTitle|订阅与席位/)).toBeTruthy());
    expect(screen.queryByText(/seatPendingWarning/)).toBeNull();
  });
});
