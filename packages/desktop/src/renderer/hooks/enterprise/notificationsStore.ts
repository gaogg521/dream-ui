/**
 * Member notification-inbox store (§4.2 of the 09-05 handoff) — module-level
 * singleton so the poller mounted in `Layout` and the titlebar bell render
 * from one state, mirroring how the WS singleton backs every emitter.
 *
 * React-independent on purpose: the polling/diff logic (seed on first load,
 * tray-notify only on arrivals *after* the seed, tenant switches reset the
 * known-id set) is unit-testable in the node project without a DOM.
 */

import { ipcBridge } from '@/common';
import type { MyNotification } from '@/common/types/platform/enterpriseTypes';

export type NotificationsState = {
  notifications: MyNotification[];
  unreadCount: number;
  /** True once a fetch has succeeded — the bell renders only then. */
  available: boolean;
  loading: boolean;
};

const EMPTY_STATE: NotificationsState = { notifications: [], unreadCount: 0, available: false, loading: false };

let state: NotificationsState = EMPTY_STATE;
const listeners = new Set<() => void>();

/** Ids seen in the last successful fetch (or the seed fetch) — tray diff basis. */
let knownIds = new Set<string>();
/** First successful fetch only seeds `knownIds`; it must not toast the whole backlog. */
let seeded = false;
let inFlight: Promise<void> | null = null;

function setState(patch: Partial<NotificationsState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* never crash a listener */
    }
  }
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getNotificationsState(): NotificationsState {
  return state;
}

/** Fire the native/system tray notification through the existing IPC bridge. */
function showTrayNotification(notification: MyNotification): void {
  // Promise.resolve wraps the mock/undefined returns of shims; .catch keeps a
  // browser WebUI session (no native notification bridge) from churning
  // unhandled rejections on every arrival.
  Promise.resolve(ipcBridge.notification.show.invoke({ title: notification.title, body: notification.body })).catch(
    () => {}
  );
}

/**
 * Fetch the inbox. The first success seeds the known-id set silently; every
 * later success trays the notifications that arrived since the previous poll
 * (unread ones only — a read receipt syncing back from another device should
 * not toast). The main process still gates tray display on window focus and
 * the user's `system.notificationEnabled` setting.
 */
export async function refreshNotifications(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    setState({ loading: true });
    try {
      const data = await ipcBridge.onePlatform.myNotifications.invoke();
      const fresh = (data.notifications ?? []).filter((n) => !knownIds.has(n.id));
      knownIds = new Set((data.notifications ?? []).map((n) => n.id));
      if (seeded) {
        for (const notification of fresh) {
          if (notification.readAt == null) showTrayNotification(notification);
        }
      }
      seeded = true;
      setState({
        notifications: data.notifications ?? [],
        unreadCount: data.unreadCount ?? 0,
        available: true,
        loading: false,
      });
    } catch {
      // Keep the last known data on transient failures — the badge just stops
      // updating. `available` stays true if it ever succeeded, so an isolated
      // 500 does not flick the bell away mid-session.
      setState({ loading: false });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Mark the given notifications read (empty array = mark all) and refresh so
 * the badge and list reflect the receipt immediately.
 */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  await ipcBridge.onePlatform.markNotificationsRead.invoke({ ids });
  await refreshNotifications();
}

/**
 * Membership changed (joined/left/switched tenants): drop the known-id set so
 * the next fetch re-seeds against the new tenant's inbox instead of toasting
 * everything already waiting there.
 */
export function resetNotifications(): void {
  knownIds = new Set();
  seeded = false;
  state = EMPTY_STATE;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* never crash a listener */
    }
  }
}
