/**
 * Enterprise org context hook — resolves the current user's tenant, role
 * and enterprise flag via /api/one/org/context (one-org crate).
 */

import { useSyncExternalStore } from 'react';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { OrgContext } from '@/common/types/org/orgTypes';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseRemoteActive,
  recordEnterpriseReachability,
} from '@/common/adapter/enterpriseMode';

/** Refresh the shared context after membership, deployment or session changes. */
export const ORG_CONTEXT_CHANGED_EVENT = 'one-org-context-changed';

export function isOrgAdminRole(role: string | null | undefined): boolean {
  return role === 'org_admin' || role === 'system_admin';
}

export function isSystemAdminRole(role: string | null | undefined): boolean {
  return role === 'system_admin';
}

export type UseOrgContextResult = {
  loading: boolean;
  context: OrgContext | null;
  error: string | null;
  /** The context call failed with 401 — i.e. a remote server IS connected but
   * this app holds no session on it yet. A "connected, not logged in" state,
   * not a malfunction: callers must render a login affordance, never the raw
   * error string (which carries the backend's JSON envelope). */
  unauthorized: boolean;
  refresh: () => Promise<void>;
};

// One snapshot keeps the footer, project-group page and identity surfaces in agreement.
// The identity key stays in memory and is never logged or persisted.
let snapshot: Omit<UseOrgContextResult, 'refresh'> = {
  context: null,
  loading: true,
  error: null,
  unauthorized: false,
};
const listeners = new Set<() => void>();
let identity = '';
let generation = 0;
let pending: Promise<void> | null = null;
let stop: (() => void) | undefined;
function currentIdentity(): string {
  return isEnterpriseRemoteActive()
    ? JSON.stringify([getEnterpriseServerUrl(), getEnterpriseSession()?.token ?? ''])
    : 'local';
}
function publish(value: typeof snapshot): void {
  snapshot = value;
  listeners.forEach((listener) => listener());
}
function refresh(force = false): Promise<void> {
  const selected = currentIdentity();
  if (pending && selected === identity && !force) return pending;
  const changed = selected !== identity;
  identity = selected;
  const requestGeneration = ++generation;
  if (changed || !snapshot.context) {
    publish({ context: null, loading: true, error: null, unauthorized: false });
  }
  const request = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ctx = await Promise.race([
        ipcBridge.oneOrg.context.invoke(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Enterprise connection timed out')), 10000);
        }),
      ]);
      if (!ctx) throw new Error('Enterprise context is unavailable');
      if (requestGeneration === generation && selected === currentIdentity()) {
        recordEnterpriseReachability(true);
        publish({ context: ctx, loading: false, error: null, unauthorized: false });
      }
    } catch (error) {
      if (requestGeneration === generation && selected === currentIdentity()) {
        publish({
          context: null,
          loading: false,
          error: String(error),
          unauthorized: isBackendHttpError(error) && error.status === 401,
        });
        const transportFailure = isBackendHttpError(error)
          ? [0, 502, 503, 504].includes(error.status)
          : error instanceof TypeError ||
            (error instanceof Error && /timed out|fetch failed|failed to fetch|network|ECONN/i.test(error.message));
        recordEnterpriseReachability(!transportFailure);
      }
    } finally {
      clearTimeout(timer);
      if (requestGeneration === generation) pending = null;
    }
  })();
  pending = request;
  return request;
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    const update = (): void => {
      void refresh();
    };
    const events = ['storage', 'focus', 'online', 'offline'];
    events.forEach((event) => window.addEventListener(event, update));
    const membershipChanged = (): void => {
      void refresh(true);
    };
    window.addEventListener(ORG_CONTEXT_CHANGED_EVENT, membershipChanged);
    const timer = window.setInterval(update, 15000);
    stop = () => {
      events.forEach((event) => window.removeEventListener(event, update));
      window.removeEventListener(ORG_CONTEXT_CHANGED_EVENT, membershipChanged);
      window.clearInterval(timer);
      generation++;
      pending = null;
    };
    update();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      stop?.();
      stop = undefined;
    }
  };
}
export function useOrgContext(): UseOrgContextResult {
  const state = useSyncExternalStore(subscribe, () => snapshot);
  return { ...state, refresh };
}
