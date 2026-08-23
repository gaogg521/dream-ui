/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The directory tab's job is not to render a table — it is to never let a
 * failed sync look like a healthy empty company, and to never fire an
 * offboarding call that cannot succeed. These tests are about that.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  directoryStatus: vi.fn(),
  directoryDeparted: vi.fn(),
  directoryPeople: vi.fn(),
  runDirectorySync: vi.fn(),
  listUsers: vi.fn(),
  orgContext: vi.fn(),
  removeUser: vi.fn(),
  removeCompanyMember: vi.fn(),
  countOwnedResources: vi.fn(),
  transferOwnership: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneEnterprise: {
      directoryStatus: { invoke: hooks.directoryStatus },
      directoryDeparted: { invoke: hooks.directoryDeparted },
      // The roster call. Missing it made every channel in this file fail with a
      // bare "cannot read invoke of undefined" that surfaced as "element not
      // found" — the component threw before rendering anything at all.
      directoryPeople: { invoke: hooks.directoryPeople },
      removeCompanyMember: { invoke: hooks.removeCompanyMember },
    },
    oneAdmin: {
      runDirectorySync: { invoke: hooks.runDirectorySync },
      listUsers: { invoke: hooks.listUsers },
      removeUser: { invoke: hooks.removeUser },
    },
    oneOrg: { context: { invoke: hooks.orgContext } },
    oneDevops: {
      countOwnedResources: { invoke: hooks.countOwnedResources },
      transferOwnership: { invoke: hooks.transferOwnership },
    },
  },
}));

// Arco's Message still calls the legacy ReactDOM.render, which throws under
// React 18+ in jsdom. Only the toast is stubbed; every other component is real.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: { ...actual.Message, success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };
});

// Render the real key so assertions read against copy identity, not wording.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const DirectoryTab = (await import('@/renderer/pages/enterprise/components/DirectoryTab')).default;

const OK_PROJECT_GROUP = 'common.enterprise.removeConfirm';
const OK_COMPANY_ONLY = 'common.enterprise.offboardCompanyOnlyConfirm';

const departedRow = (tenants: { tenantId: string; name: string }[]) => ({
  userId: 'u_b',
  externalId: 'ou_b',
  displayName: '李四',
  department: '研发中心',
  missingSince: 1_700_000_000,
  tenants,
});

/** Open the dialog for the single departed row on screen. */
const openOffboardDialog = async () => {
  await waitFor(() => expect(screen.getByText('李四')).toBeTruthy());
  fireEvent.click(screen.getByText('common.enterprise.directoryOffboard'));
};

beforeEach(() => {
  for (const fn of Object.values(hooks)) fn.mockReset();
  hooks.directoryDeparted.mockResolvedValue([]);
  hooks.directoryPeople.mockResolvedValue([]);
  hooks.listUsers.mockResolvedValue([
    { userId: 'u_b', username: 'bob', displayName: '李四', role: 'member' },
    { userId: 'u_c', username: 'carol', displayName: '王五', role: 'member' },
  ]);
  hooks.orgContext.mockResolvedValue({
    tenantId: 't_1',
    tenantName: '研发组',
    role: 'system_admin',
    isEnterprise: true,
    memberCount: 2,
  });
  hooks.removeUser.mockResolvedValue(undefined);
  hooks.removeCompanyMember.mockResolvedValue(undefined);
  hooks.countOwnedResources.mockResolvedValue(0);
  // jsdom does not implement matchMedia; arco-design's responsive components
  // (Descriptions here) need it. Same stub the other DOM tests use.
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

describe('DirectoryTab', () => {
  it('warns when the last sync did not finish, instead of showing a reassuring empty list', async () => {
    hooks.directoryStatus.mockResolvedValue({
      provider: 'feishu',
      lastStatus: 'partial',
      lastError: 'tenant token: HTTP 500',
      departmentCount: 3,
      peopleCount: 12,
    });

    render(<DirectoryTab />);

    // The banner is the whole point: a partial pull means the mirror is stale
    // AND no departures were derived, so an empty "departed" table below is
    // not evidence that nobody left.
    await waitFor(() => {
      expect(screen.getByText('common.enterprise.directoryPartialBanner')).toBeTruthy();
    });
  });

  it('shows no warning after a complete sync', async () => {
    hooks.directoryStatus.mockResolvedValue({
      provider: 'feishu',
      lastStatus: 'ok',
      departmentCount: 3,
      peopleCount: 12,
    });

    render(<DirectoryTab />);

    await waitFor(() => {
      expect(screen.getByText('common.enterprise.directoryStatusTitle')).toBeTruthy();
    });
    expect(screen.queryByText('common.enterprise.directoryPartialBanner')).toBeNull();
  });

  it('offers a per-row action and no way to offboard everybody at once', async () => {
    hooks.directoryStatus.mockResolvedValue({
      provider: 'feishu',
      lastStatus: 'ok',
      departmentCount: 1,
      peopleCount: 2,
    });
    hooks.directoryDeparted.mockResolvedValue([
      departedRow([{ tenantId: 't_1', name: '研发组' }]),
      { ...departedRow([]), userId: 'u_d', externalId: 'ou_d', displayName: '赵六' },
    ]);

    render(<DirectoryTab />);

    await waitFor(() => expect(screen.getByText('李四')).toBeTruthy());
    // One action per row, reviewed individually. A bulk action would let a
    // single bad pull offboard the whole company in one click, which is the
    // failure the whole feature is designed around.
    expect(screen.getAllByText('common.enterprise.directoryOffboard')).toHaveLength(2);
  });

  it('runs the full flow for somebody in the admin’s own project group', async () => {
    hooks.directoryStatus.mockResolvedValue({
      provider: 'feishu',
      lastStatus: 'ok',
      departmentCount: 1,
      peopleCount: 1,
    });
    hooks.directoryDeparted.mockResolvedValue([departedRow([{ tenantId: 't_1', name: '研发组' }])]);
    hooks.countOwnedResources.mockResolvedValue(2);

    render(<DirectoryTab />);
    await openOffboardDialog();

    // Project-group mode: it can hand resources over, so it says what they own.
    await waitFor(() => expect(screen.getByText('common.enterprise.removeOwnedResources')).toBeTruthy());
    fireEvent.click(screen.getByText(OK_PROJECT_GROUP));

    await waitFor(() => expect(hooks.removeUser).toHaveBeenCalledWith({ userId: 'u_b' }));
    // Company-seat release (if this was their last project group) now happens
    // automatically on the backend (OrgService::remove_member /
    // CompanySeatSync::release_company_member) — see the comment above the
    // removeUser call in OffboardMemberModal. Calling removeCompanyMember here
    // too used to be unconditional and would wrongly release the seat of a
    // multi-group member who still belonged to another group under the same
    // company, so this modal no longer makes that second call.
    expect(hooks.removeCompanyMember).not.toHaveBeenCalled();
  });

  it('falls back to releasing the seat when the person is in a different project group', async () => {
    hooks.directoryStatus.mockResolvedValue({
      provider: 'feishu',
      lastStatus: 'ok',
      departmentCount: 1,
      peopleCount: 1,
    });
    hooks.directoryDeparted.mockResolvedValue([departedRow([{ tenantId: 't_9', name: '市场组' }])]);

    render(<DirectoryTab />);
    await openOffboardDialog();

    // The admin is standing in t_1; removal acts on t_1 and would be rejected.
    // So the dialog names the group that still needs attention instead.
    await waitFor(() => expect(screen.getByText('common.enterprise.offboardStillInGroups')).toBeTruthy());
    expect(screen.queryByText('common.enterprise.removeOwnedResources')).toBeNull();

    fireEvent.click(screen.getByText(OK_COMPANY_ONLY));

    await waitFor(() => expect(hooks.removeCompanyMember).toHaveBeenCalledWith({ userId: 'u_b' }));
    // ⚠️ The point of the mode split: firing this would 400 and leave the seat
    // occupied while showing the admin a raw backend error.
    expect(hooks.removeUser).not.toHaveBeenCalled();
  });

  it('treats a member of no project group as a company-only removal', async () => {
    hooks.directoryStatus.mockResolvedValue({
      provider: 'feishu',
      lastStatus: 'ok',
      departmentCount: 1,
      peopleCount: 1,
    });
    hooks.directoryDeparted.mockResolvedValue([departedRow([])]);

    render(<DirectoryTab />);
    await openOffboardDialog();

    await waitFor(() => expect(screen.getByText(OK_COMPANY_ONLY)).toBeTruthy());
    // Nothing to point at, so no "still in these groups" warning either.
    expect(screen.queryByText('common.enterprise.offboardStillInGroups')).toBeNull();

    fireEvent.click(screen.getByText(OK_COMPANY_ONLY));
    await waitFor(() => expect(hooks.removeCompanyMember).toHaveBeenCalledWith({ userId: 'u_b' }));
    expect(hooks.removeUser).not.toHaveBeenCalled();
  });

  it('keeps the previous data on screen when a refresh fails', async () => {
    hooks.directoryStatus.mockRejectedValue(new Error('offline'));
    hooks.directoryDeparted.mockRejectedValue(new Error('offline'));
    hooks.listUsers.mockRejectedValue(new Error('not a group admin'));

    render(<DirectoryTab />);

    // A failed refresh is not evidence that the directory is empty, so the
    // page must still render rather than blanking or throwing. The roster is
    // fetched separately and its failure only costs the hand-over dropdown.
    await waitFor(() => {
      expect(screen.getByText('common.enterprise.directoryStatusTitle')).toBeTruthy();
    });
  });
});
