/**
 * Notifications store (§4.2) — the tray-diff/read-receipt logic, isolated
 * from React by design so the seed-then-notify contract is testable in node.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above const declarations — hoist the mocks
// with them or the factory runs before its own mocks exist.
const { trayShow, myNotifications, markNotificationsReadApi } = vi.hoisted(() => ({
  trayShow: vi.fn(),
  myNotifications: vi.fn(),
  markNotificationsReadApi: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    notification: { show: { invoke: trayShow } },
    onePlatform: {
      myNotifications: { invoke: myNotifications },
      markNotificationsRead: { invoke: markNotificationsReadApi },
    },
  },
}));

import {
  getNotificationsState,
  markNotificationsRead,
  refreshNotifications,
  resetNotifications,
} from '@/renderer/hooks/enterprise/notificationsStore';
import type { MyNotification } from '@/common/types/platform/enterpriseTypes';

const notification = (id: string, overrides: Partial<MyNotification> = {}): MyNotification => ({
  id,
  kind: 'broadcast',
  category: '',
  title: `t-${id}`,
  body: `b-${id}`,
  createdBy: 'admin',
  createdAt: 1_700_000_000_000,
  readAt: null,
  ...overrides,
});

const inbox = (notifications: MyNotification[]) => ({ notifications, unreadCount: notifications.filter((n) => n.readAt == null).length });

beforeEach(() => {
  vi.clearAllMocks();
  resetNotifications();
});

describe('notificationsStore', () => {
  it('seeds silently: the first fetch fills the badge but must not tray-toast the backlog', async () => {
    myNotifications.mockResolvedValue(inbox([notification('a'), notification('b')]));

    await refreshNotifications();

    expect(trayShow).not.toHaveBeenCalled();
    expect(getNotificationsState().unreadCount).toBe(2);
    expect(getNotificationsState().available).toBe(true);
  });

  it('trays only unread arrivals that appear after the seed', async () => {
    myNotifications.mockResolvedValueOnce(inbox([notification('a')]));
    await refreshNotifications();

    myNotifications.mockResolvedValueOnce(inbox([notification('a'), notification('new1'), notification('new2', { readAt: 123 })]));
    await refreshNotifications();

    expect(trayShow).toHaveBeenCalledTimes(1);
    expect(trayShow).toHaveBeenCalledWith(expect.objectContaining({ title: 't-new1' }));
    // The read one (new2) drops out of the badge; a and new1 remain.
    expect(getNotificationsState().unreadCount).toBe(2);
  });

  it('does not double-toast on repeated fetches of the same inbox', async () => {
    myNotifications.mockResolvedValue(inbox([notification('a')]));
    await refreshNotifications();
    await refreshNotifications();
    await refreshNotifications();

    expect(trayShow).not.toHaveBeenCalled();
  });

  it('keeps the last good state on a transient failure instead of flicking the bell away', async () => {
    myNotifications.mockResolvedValueOnce(inbox([notification('a')]));
    await refreshNotifications();

    myNotifications.mockRejectedValueOnce(new Error('boom'));
    await refreshNotifications();

    const state = getNotificationsState();
    expect(state.available).toBe(true);
    expect(state.notifications).toHaveLength(1);
    expect(state.loading).toBe(false);
  });

  it('markNotificationsRead sends the ids and reflects the receipt in state', async () => {
    myNotifications.mockResolvedValueOnce(inbox([notification('a'), notification('b')]));
    await refreshNotifications();

    markNotificationsReadApi.mockResolvedValue(undefined);
    myNotifications.mockResolvedValueOnce(inbox([notification('a', { readAt: 5 }), notification('b')]));
    await markNotificationsRead(['a']);

    expect(markNotificationsReadApi).toHaveBeenCalledWith({ ids: ['a'] });
    expect(getNotificationsState().unreadCount).toBe(1);
  });

  it('resetNotifications clears the seed so a tenant switch does not toast the new backlog', async () => {
    myNotifications.mockResolvedValueOnce(inbox([notification('a')]));
    await refreshNotifications();

    resetNotifications();
    myNotifications.mockResolvedValueOnce(inbox([notification('a'), notification('b')]));
    await refreshNotifications();

    expect(trayShow).not.toHaveBeenCalled();
    expect(getNotificationsState().unreadCount).toBe(2);
  });
});
