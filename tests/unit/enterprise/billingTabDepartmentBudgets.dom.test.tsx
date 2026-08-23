/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * T7: a department cap is a tighter constraint layered under the company-wide
 * one. These tests cover the admin UI that sets it — the card must only
 * appear when there is a department to configure, and saving must round-trip
 * through the dollars-to-micros conversion correctly.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  plan: vi.fn(),
  usage: vi.fn(),
  license: vi.fn(),
  listDepartments: vi.fn(),
  listDepartmentBudgets: vi.fn(),
  setDepartmentBudget: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneBilling: {
      plan: { invoke: hooks.plan },
      usage: { invoke: hooks.usage },
      license: { invoke: hooks.license },
      listDepartmentBudgets: { invoke: hooks.listDepartmentBudgets },
      setDepartmentBudget: { invoke: hooks.setDepartmentBudget },
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
  tier: 'team',
  seatUsed: 3,
  seatLimit: 25,
  seatPending: 0,
  expiresAt: null,
  entitlements: [],
  costCapMicros: null,
  costUsedMicros: 0,
  allowedModels: [],
};

beforeEach(() => {
  hooks.plan.mockReset().mockResolvedValue(basePlan);
  hooks.usage.mockReset().mockResolvedValue(null);
  hooks.license.mockReset().mockResolvedValue(null);
  hooks.listDepartments.mockReset().mockResolvedValue([]);
  hooks.listDepartmentBudgets.mockReset().mockResolvedValue([]);
  hooks.setDepartmentBudget.mockReset();
});

describe('BillingTab department budgets', () => {
  it('does not render the card when there are no departments to configure', async () => {
    render(<BillingTab />);
    await waitFor(() => expect(screen.getByText(/billing.planTitle/)).toBeTruthy());
    expect(screen.queryByText(/billing.deptBudgetTitle/)).toBeNull();
  });

  it('lists every department and saves a cap converted from dollars to micros', async () => {
    hooks.listDepartments.mockResolvedValue([
      { id: 'dept_a', tenantId: 't1', parentId: null, name: '研发部', createdAt: 0, updatedAt: 0, source: null },
    ]);
    hooks.listDepartmentBudgets.mockResolvedValue([]);
    hooks.setDepartmentBudget.mockResolvedValue([
      { departmentId: 'dept_a', costCapMicros: 5_000_000, costUsedMicros: 0 },
    ]);

    render(<BillingTab />);
    await waitFor(() => expect(screen.getByText('研发部')).toBeTruthy());

    const capInput = screen.getByPlaceholderText(/billing.unlimited/);
    fireEvent.change(capInput, { target: { value: '5' } });

    const saveButton = screen.getByText(/^common\.billing\.save\{/);
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(hooks.setDepartmentBudget).toHaveBeenCalledWith({ departmentId: 'dept_a', costCapMicros: 5_000_000 })
    );
  });

  it('clearing the input saves a null cap (removes the department-level limit)', async () => {
    hooks.listDepartments.mockResolvedValue([
      { id: 'dept_a', tenantId: 't1', parentId: null, name: '研发部', createdAt: 0, updatedAt: 0, source: null },
    ]);
    hooks.listDepartmentBudgets.mockResolvedValue([
      { departmentId: 'dept_a', costCapMicros: 5_000_000, costUsedMicros: 1_000_000 },
    ]);
    hooks.setDepartmentBudget.mockResolvedValue([
      { departmentId: 'dept_a', costCapMicros: null, costUsedMicros: 1_000_000 },
    ]);

    render(<BillingTab />);
    await waitFor(() => expect(screen.getByText('研发部')).toBeTruthy());

    const capInput = screen.getByDisplayValue('5');
    fireEvent.change(capInput, { target: { value: '' } });
    fireEvent.click(screen.getByText(/^common\.billing\.save\{/));

    await waitFor(() =>
      expect(hooks.setDepartmentBudget).toHaveBeenCalledWith({ departmentId: 'dept_a', costCapMicros: null })
    );
  });
});
