/**
 * The notifications poller's reset boundary.
 *
 * `notificationsStore` is a module-level singleton and its `available` flag is
 * what gates the titlebar bell (`if (!available) return null`). The reset used
 * to sit *after* an `if (!isEnterprise) return`, so it only ever ran while
 * already in enterprise mode: leaving enterprise left the singleton populated,
 * and the bell stayed on screen listing the previous tenant's notifications
 * until the app restarted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { orgContext, resetNotifications, refreshNotifications } = vi.hoisted(() => ({
  orgContext: { current: { isEnterprise: false, tenantId: null as string | null } },
  resetNotifications: vi.fn(),
  refreshNotifications: vi.fn(() => Promise.resolve()),
}));

vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({
  useOrgContext: () => ({ context: orgContext.current }),
}));

vi.mock('@/renderer/hooks/enterprise/notificationsStore', () => ({
  getNotificationsState: () => ({ notifications: [], unreadCount: 0, available: false, loading: false }),
  markNotificationsRead: vi.fn(),
  refreshNotifications,
  resetNotifications,
  subscribeNotifications: () => () => {},
}));

import { useEnterpriseNotificationsSync } from '@/renderer/hooks/enterprise/useEnterpriseNotifications';

describe('useEnterpriseNotificationsSync', () => {
  beforeEach(() => {
    resetNotifications.mockClear();
    refreshNotifications.mockClear();
    orgContext.current = { isEnterprise: false, tenantId: null };
  });

  it('clears the singleton when the member leaves enterprise mode', () => {
    orgContext.current = { isEnterprise: true, tenantId: 't1' };
    const { rerender } = renderHook(() => useEnterpriseNotificationsSync());
    expect(resetNotifications).toHaveBeenCalledTimes(1);

    // Back to personal mode: nothing polls any more, but the inbox that is
    // still in the singleton belongs to an org this client just left.
    orgContext.current = { isEnterprise: false, tenantId: null };
    rerender();

    expect(resetNotifications).toHaveBeenCalledTimes(2);
    expect(refreshNotifications).toHaveBeenCalledTimes(1);
  });

  it('re-seeds against the new inbox on a tenant switch', () => {
    orgContext.current = { isEnterprise: true, tenantId: 't1' };
    const { rerender } = renderHook(() => useEnterpriseNotificationsSync());
    orgContext.current = { isEnterprise: true, tenantId: 't2' };
    rerender();

    expect(resetNotifications).toHaveBeenCalledTimes(2);
    expect(refreshNotifications).toHaveBeenCalledTimes(2);
  });

  it('does not poll while the client is not in enterprise mode', () => {
    renderHook(() => useEnterpriseNotificationsSync());
    expect(refreshNotifications).not.toHaveBeenCalled();
  });
});
