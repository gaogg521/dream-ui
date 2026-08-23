/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The offboarding dialog, shared by the members page and the directory's
 * departed list.
 *
 * These tests guard the two things that are easy to break and expensive when
 * broken: the **order** of the calls (a hand-over after the removal would race
 * it, and the recipient check would already have failed), and the fact that
 * company-only mode never touches the project-group endpoints.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  removeUser: vi.fn(),
  removeCompanyMember: vi.fn(),
  countOwnedResources: vi.fn(),
  transferOwnership: vi.fn(),
  calls: [] as string[],
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    oneAdmin: { removeUser: { invoke: hooks.removeUser } },
    oneEnterprise: { removeCompanyMember: { invoke: hooks.removeCompanyMember } },
    oneDevops: {
      countOwnedResources: { invoke: hooks.countOwnedResources },
      transferOwnership: { invoke: hooks.transferOwnership },
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

const OffboardMemberModal = (await import('@/renderer/pages/enterprise/components/OffboardMemberModal')).default;

const target = { userId: 'u_b', displayName: '李四' };
const candidates = [{ userId: 'u_c', label: '王五' }];

beforeEach(() => {
  hooks.calls.length = 0;
  hooks.removeUser.mockReset().mockImplementation(async () => {
    hooks.calls.push('removeUser');
  });
  hooks.removeCompanyMember.mockReset().mockImplementation(async () => {
    hooks.calls.push('removeCompanyMember');
  });
  hooks.transferOwnership.mockReset().mockImplementation(async () => {
    hooks.calls.push('transferOwnership');
    return 3;
  });
  hooks.countOwnedResources.mockReset().mockResolvedValue(3);
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

describe('OffboardMemberModal', () => {
  it('hands resources over before removing, then releases the company seat', async () => {
    render(
      <OffboardMemberModal
        target={target}
        mode='project-group'
        candidates={candidates}
        onCancel={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('common.enterprise.removeOwnedResources')).toBeTruthy());

    // Pick the recipient through the real Arco Select. It renders the
    // placeholder in more than one node, so take the first.
    fireEvent.click(screen.getAllByText('common.enterprise.transferPlaceholder')[0]);
    await waitFor(() => expect(screen.getAllByText('王五').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('王五')[0]);

    fireEvent.click(screen.getByText('common.enterprise.removeConfirm'));

    // ⚠️ Order is load-bearing: `transfer_ownership` requires the recipient to
    // be a member of the group, so it cannot run after the removal.
    // Releasing the company seat (if this was the member's last group under
    // the company) now happens automatically on the backend inside
    // `removeUser` — see `OrgService::remove_member` — so the modal no
    // longer calls `removeCompanyMember` itself.
    await waitFor(() => expect(hooks.calls).toEqual(['transferOwnership', 'removeUser']));
  });

  it('still removes when there is nothing to hand over', async () => {
    hooks.countOwnedResources.mockResolvedValue(0);
    const onDone = vi.fn();
    render(
      <OffboardMemberModal target={target} mode='project-group' candidates={[]} onCancel={vi.fn()} onDone={onDone} />
    );

    await waitFor(() => expect(screen.getByText('common.enterprise.removeBody')).toBeTruthy());
    expect(screen.queryByText('common.enterprise.removeOwnedResources')).toBeNull();

    fireEvent.click(screen.getByText('common.enterprise.removeConfirm'));
    // Seat release (if applicable) happens inside `removeUser` on the
    // backend now — see the comment on the test above.
    await waitFor(() => expect(hooks.calls).toEqual(['removeUser']));
    expect(onDone).toHaveBeenCalledWith('u_b');
  });

  it('company-only mode releases the seat and never calls the project-group endpoints', async () => {
    render(
      <OffboardMemberModal
        target={{ ...target, tenants: [{ tenantId: 't_9', name: '市场组' }] }}
        mode='company-only'
        candidates={candidates}
        onCancel={vi.fn()}
        onDone={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('common.enterprise.offboardStillInGroups')).toBeTruthy());
    // No counting either: there is nothing this admin could hand over from here,
    // and asking would suggest otherwise.
    expect(hooks.countOwnedResources).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('common.enterprise.offboardCompanyOnlyConfirm'));
    await waitFor(() => expect(hooks.calls).toEqual(['removeCompanyMember']));
  });

  it('keeps the dialog open when the removal fails, instead of pretending it worked', async () => {
    hooks.countOwnedResources.mockResolvedValue(0);
    hooks.removeUser.mockRejectedValue(new Error('user u_b not in tenant t_1'));
    const onDone = vi.fn();
    render(
      <OffboardMemberModal target={target} mode='project-group' candidates={[]} onCancel={vi.fn()} onDone={onDone} />
    );

    await waitFor(() => expect(screen.getByText('common.enterprise.removeBody')).toBeTruthy());
    fireEvent.click(screen.getByText('common.enterprise.removeConfirm'));

    await waitFor(() => expect(hooks.removeUser).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
    // The seat must not be released off the back of a failed group removal.
    expect(hooks.removeCompanyMember).not.toHaveBeenCalled();
  });
});
