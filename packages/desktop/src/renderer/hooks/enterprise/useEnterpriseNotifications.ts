/**
 * React glue for the notifications store (§4.2).
 *
 * - `useEnterpriseNotificationsSync` — mount once in `Layout` alongside
 *   `useTeamResourceSync`: polls the member inbox every 60s while a tenant is
 *   resolved, re-syncs when the tab becomes visible again, and resets the
 *   known-id set when the active tenant changes. No-op in standalone mode.
 * - `useEnterpriseNotifications` — subscribe the bell (and any other surface)
 *   to the shared state and expose the read-receipt actions.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { useEffect } from 'react';
import {
  getNotificationsState,
  markNotificationsRead,
  refreshNotifications,
  resetNotifications,
  subscribeNotifications,
  type NotificationsState,
} from './notificationsStore';

const POLL_INTERVAL_MS = 60_000;

export function useEnterpriseNotificationsSync(): void {
  const { context } = useOrgContext();
  const isEnterprise = context?.isEnterprise ?? false;
  const tenantId = context?.tenantId ?? null;

  useEffect(() => {
    if (!isEnterprise) return;
    // Tenant switch (or first enterprise mount): re-seed against this tenant's inbox.
    resetNotifications();
    void refreshNotifications();
    const timer = window.setInterval((): void => void refreshNotifications(), POLL_INTERVAL_MS);
    // A laptop waking from sleep or a long-hidden window should catch up at
    // once, not wait out the next full interval.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isEnterprise, tenantId]);
}

export type UseEnterpriseNotificationsResult = NotificationsState & {
  refresh: () => Promise<void>;
  /** Empty ids = mark everything read. */
  markRead: (ids: string[]) => Promise<void>;
};

export function useEnterpriseNotifications(): UseEnterpriseNotificationsResult {
  const state = useSyncExternalStore(subscribeNotifications, getNotificationsState, getNotificationsState);
  const refresh = useCallback(() => refreshNotifications(), []);
  const markRead = useCallback((ids: string[]) => markNotificationsRead(ids), []);
  return { ...state, refresh, markRead };
}
