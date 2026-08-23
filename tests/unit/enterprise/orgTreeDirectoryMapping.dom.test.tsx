/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * T6 stage 3: mapping a company directory subtree into the project group's
 * department tree. These tests cover the new picker/mapping flow only — the
 * pre-existing create/rename/delete behavior is unchanged and already
 * covered at the backend service level (`OrgService` tests).
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  listDepartments: vi.fn(),
  listDirectoryCandidates: vi.fn(),
  mapFromDirectory: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneAdmin: {
      listDepartments: { invoke: hooks.listDepartments },
      listDirectoryCandidates: { invoke: hooks.listDirectoryCandidates },
      mapFromDirectory: { invoke: hooks.mapFromDirectory },
      createDepartment: { invoke: vi.fn() },
      renameDepartment: { invoke: vi.fn() },
      deleteDepartment: { invoke: vi.fn() },
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

const OrgTreeTab = (await import('@/renderer/pages/enterprise/components/OrgTreeTab')).default;

const openMapModal = async () => {
  await waitFor(() => expect(hooks.listDepartments).toHaveBeenCalled());
  fireEvent.click(screen.getByText('common.orgTree.mapButton{"defaultValue":"从通讯录映射"}'));
  await waitFor(() => expect(hooks.listDirectoryCandidates).toHaveBeenCalled());
};

beforeEach(() => {
  hooks.listDepartments.mockReset().mockResolvedValue([]);
  hooks.listDirectoryCandidates.mockReset().mockResolvedValue([]);
  hooks.mapFromDirectory.mockReset();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OrgTreeTab directory mapping', () => {
  it('shows "nothing to map" when the directory has never been synced', async () => {
    render(<OrgTreeTab />);
    await openMapModal();

    await waitFor(() => expect(screen.getByText(/mapEmpty/)).toBeTruthy());
  });

  it('maps a picked subtree and reports what happened', async () => {
    hooks.listDirectoryCandidates.mockResolvedValue([
      { externalId: 'od_root', parentExternalId: null, name: '研发中心' },
      { externalId: 'od_child', parentExternalId: 'od_root', name: '后端组' },
    ]);
    hooks.mapFromDirectory.mockResolvedValue({
      created: ['研发中心', '后端组'],
      updated: [],
      removed: [],
      keptWithLocalData: [],
    });

    render(<OrgTreeTab />);
    await openMapModal();

    // Real Arco Select — click the placeholder to open it, same pattern as
    // the OffboardMemberModal tests.
    fireEvent.click(screen.getAllByText('common.orgTree.mapRootPlaceholder{"defaultValue":"选择根部门"}')[0]);
    await waitFor(() => expect(screen.getAllByText('研发中心').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('研发中心')[0]);

    fireEvent.click(screen.getByRole('button', { name: /^OK$|确定/ }));

    await waitFor(() => expect(hooks.mapFromDirectory).toHaveBeenCalledWith({ rootExternalId: 'od_root' }));
  });

  it('surfaces rows that were kept because local data is still attached', async () => {
    hooks.listDirectoryCandidates.mockResolvedValue([
      { externalId: 'od_root', parentExternalId: null, name: '研发中心' },
    ]);
    hooks.mapFromDirectory.mockResolvedValue({
      created: [],
      updated: ['研发中心'],
      removed: [],
      keptWithLocalData: ['后端组'],
    });

    render(<OrgTreeTab />);
    await openMapModal();

    fireEvent.click(screen.getAllByText('common.orgTree.mapRootPlaceholder{"defaultValue":"选择根部门"}')[0]);
    await waitFor(() => expect(screen.getAllByText('研发中心').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('研发中心')[0]);
    fireEvent.click(screen.getByRole('button', { name: /^OK$|确定/ }));

    await waitFor(() => expect(hooks.mapFromDirectory).toHaveBeenCalled());
    // The Message.warning mock captured the "kept" summary — assert it named
    // the row rather than silently dropping the information.
    const { Message } = await import('@arco-design/web-react');
    await waitFor(() => {
      const calls = (Message.warning as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(calls.some((m) => m.includes('后端组'))).toBe(true);
    });
  });

  it('tags a directory-mapped department in the tree, distinct from a manual one', async () => {
    hooks.listDepartments.mockResolvedValue([
      { id: 'd1', tenantId: 't1', parentId: null, name: '研发中心', createdAt: 0, updatedAt: 0, source: 'directory' },
      { id: 'd2', tenantId: 't1', parentId: null, name: '手工部门', createdAt: 0, updatedAt: 0, source: null },
    ]);

    render(<OrgTreeTab />);

    await waitFor(() => expect(screen.getByText('研发中心')).toBeTruthy());
    // Only one tag — the manual department gets none.
    expect(screen.getAllByText(/orgTree\.mappedTag/)).toHaveLength(1);
  });
});
