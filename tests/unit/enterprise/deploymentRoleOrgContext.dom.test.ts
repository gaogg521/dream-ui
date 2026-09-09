/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Switching the deployment role away from a company — or re-pointing the client
 * at a different one — changes what "my org" means. Everything derived from the
 * org context has to re-derive, and the hooks that do the deriving listen on
 * ORG_CONTEXT_CHANGED_EVENT, not on DEPLOYMENT_ROLE_CHANGED_EVENT. The
 * team-resource sync's leaving purge keys on the context flipping to
 * not-enterprise, so without this event it never fires and an enterprise-issued
 * model channel survives the switch back to the personal workspace.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEPLOYMENT_ROLE_CHANGED_EVENT,
  WEBUI_DEPLOYMENT_ROLE_KEY,
  WEBUI_ENTERPRISE_SERVER_URL_KEY,
} from '@/common/config/webuiEnterpriseConfig';
import { ORG_CONTEXT_CHANGED_EVENT } from '@renderer/pages/enterprise/hooks/useOrgContext';

const store = new Map<string, unknown>();
const enterpriseServerUrl = { value: null as string | null };

vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: () => Promise.resolve(),
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
  },
}));

const setEnterpriseSession = vi.fn();
const clearEnterpriseRemotePointer = vi.fn(() => {
  enterpriseServerUrl.value = null;
});

vi.mock('@/common/adapter/enterpriseMode', () => ({
  getEnterpriseServerUrl: () => enterpriseServerUrl.value,
  setEnterpriseServerUrl: (url: string) => {
    enterpriseServerUrl.value = url;
  },
  setEnterpriseSession: (session: unknown) => setEnterpriseSession(session),
  clearEnterpriseRemotePointer: () => clearEnterpriseRemotePointer(),
}));

/** Counts of each event this module fires, for the window it is listening. */
function recordEvents(): { org: number; role: number; stop: () => void } {
  const counts = { org: 0, role: 0, stop: () => {} };
  const onOrg = () => {
    counts.org += 1;
  };
  const onRole = () => {
    counts.role += 1;
  };
  window.addEventListener(ORG_CONTEXT_CHANGED_EVENT, onOrg);
  window.addEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, onRole);
  counts.stop = () => {
    window.removeEventListener(ORG_CONTEXT_CHANGED_EVENT, onOrg);
    window.removeEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, onRole);
  };
  return counts;
}

describe('deployment role changes announce the new org context', () => {
  beforeEach(() => {
    store.clear();
    enterpriseServerUrl.value = null;
    vi.clearAllMocks();
  });

  it('fires when the machine leaves client mode for server mode', async () => {
    enterpriseServerUrl.value = 'http://192.168.1.10:25809';
    store.set(WEBUI_ENTERPRISE_SERVER_URL_KEY, 'http://192.168.1.10:25809');
    const { persistDeploymentRole } = await import('@renderer/hooks/enterprise/useDeploymentRole');
    const events = recordEvents();

    await persistDeploymentRole('server');

    expect(clearEnterpriseRemotePointer).toHaveBeenCalledTimes(1);
    expect(events.org).toBe(1);
    expect(events.role).toBe(1);
    events.stop();
  });

  it('fires when the client is re-pointed at a different server, and clears the session', async () => {
    enterpriseServerUrl.value = 'http://192.168.1.10:25809';
    store.set(WEBUI_DEPLOYMENT_ROLE_KEY, 'client');
    const { persistDeploymentServerUrl } = await import('@renderer/hooks/enterprise/useDeploymentRole');
    const events = recordEvents();

    await persistDeploymentServerUrl('http://192.168.1.99:25809');

    expect(setEnterpriseSession).toHaveBeenCalledWith(null);
    expect(events.org).toBe(1);
    events.stop();
  });

  it('stays quiet when the same address is saved again', async () => {
    // Re-saving the address you are already on is not an identity change, and
    // must not force a re-login or a full org-context refetch.
    enterpriseServerUrl.value = 'http://192.168.1.10:25809';
    store.set(WEBUI_DEPLOYMENT_ROLE_KEY, 'client');
    const { persistDeploymentServerUrl } = await import('@renderer/hooks/enterprise/useDeploymentRole');
    const events = recordEvents();

    await persistDeploymentServerUrl('http://192.168.1.10:25809');

    expect(setEnterpriseSession).not.toHaveBeenCalled();
    expect(events.org).toBe(0);
    expect(events.role).toBe(1);
    events.stop();
  });
});
