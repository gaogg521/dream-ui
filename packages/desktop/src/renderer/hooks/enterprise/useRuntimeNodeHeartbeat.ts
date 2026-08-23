/**
 * Enterprise runtime-node heartbeat (renderer side).
 *
 * The "运行时节点" (Runtime Nodes) admin tab lists machines that have
 * self-reported into `/api/one/admin/runtime/heartbeat`. Nothing ever called
 * that endpoint — the tab existed but was permanently empty. This hook is the
 * missing sender: while a desktop client is inside an enterprise, it reports
 * this machine's identity (a locally-persisted machine id, hostname, IP
 * addresses) on mount and periodically thereafter, mirroring
 * `useTeamResourceSync`'s pattern.
 *
 * ADDITIVE / standalone-safe: the effect returns early unless this is a
 * desktop client with a resolved enterprise tenant. In standalone mode
 * nothing runs — no identity lookup, no heartbeat request, no timer.
 *
 * `installedAgents` is intentionally left empty for now — there is no
 * existing endpoint that cheaply reports "which CLI agents are installed on
 * this machine" (the closest match, `AgentRegistry::list_management_rows`,
 * is fully implemented but never wired to a route). Wiring that up is a
 * separate, larger addition; the roster is still useful without it (machine
 * identity + reachability), and an empty list is honest rather than faked.
 */

import { useEffect } from 'react';
import { ipcBridge } from '@/common';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { isElectronDesktop } from '@renderer/utils/platform';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

async function sendHeartbeat(): Promise<void> {
  try {
    const identity = await ipcBridge.application.getRuntimeNodeIdentity.invoke();
    await ipcBridge.oneAdmin.runtimeHeartbeat.invoke({
      machineId: identity.machineId,
      displayName: identity.hostname,
      hostnames: [identity.hostname],
      ipAddresses: identity.ipAddresses,
      installedAgents: [],
    });
  } catch {
    // Best-effort — a missed heartbeat just means this node looks stale in
    // the roster until the next successful one; never surface to the user.
  }
}

export function useRuntimeNodeHeartbeat(): void {
  const { context } = useOrgContext();
  const isEnterprise = context?.isEnterprise ?? false;

  useEffect(() => {
    // standalone, or a browser thin-client → never heartbeat
    if (!isEnterprise || !isElectronDesktop()) return;
    void sendHeartbeat();
    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isEnterprise]);
}
