/**
 * M3 — drive team resource sync while the member is in an enterprise context.
 *
 * ADDITIVE / standalone-safe: the effect returns early unless this is a desktop
 * client with a resolved tenant (`context.isEnterprise`). In standalone mode
 * nothing runs — no fetch, no local materialization, no timers.
 *
 * Desktop-only: offline materialization only makes sense on a desktop client
 * that runs its own co-located backend. Browser WebUI sessions are thin clients
 * to the server (which already holds the registry), so we skip them.
 */

import { useEffect } from 'react';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { isElectronDesktop } from '@renderer/utils/platform';
import {
  syncContentInspection,
  syncTeamAgents,
  syncTeamMcp,
  syncTeamModelChannels,
  syncTeamSkills,
} from '@renderer/utils/enterprise/teamSkillSync';
import { fulfilAuditUploadRequests } from '@renderer/utils/enterprise/conversationShare';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function useTeamResourceSync(): void {
  const { context } = useOrgContext();
  const isEnterprise = context?.isEnterprise ?? false;

  useEffect(() => {
    // standalone, or a browser thin-client → never sync
    if (!isEnterprise || !isElectronDesktop()) return;
    const syncAll = () => {
      void syncTeamSkills();
      void syncTeamMcp();
      // P1-3: team-distributed digital employees ride the same timer. An
      // admin who publishes/authorizes an employee (or revokes it) reaches
      // the member's employee list within one cycle; locally the rows land
      // in the normal registry, so no other UI changes.
      void syncTeamAgents();
      // Model channels ride the same timer: a channel the admin adds, retires
      // or re-scopes should reach members without them restarting anything,
      // and the token this refreshes is what a revocation invalidates.
      void syncTeamModelChannels();
      // Content rules ride the same timer, and the same call ships back the
      // findings this machine recorded.
      //
      // ⚠️ Two consequences of the interval, both accepted: a rule the admin
      // adds takes up to one cycle to start applying, and a finding takes up to
      // one cycle to become visible in the console. The alternative — checking
      // with the server per send — is the design this deliberately avoids.
      void syncContentInspection();
      // P2-3 on_demand tier: pick up admin content requests. The request was
      // audited when the admin made it; the upload lands a snapshot under the
      // member's own server identity. Best-effort: failures retry next cycle.
      void fulfilAuditUploadRequests();
    };
    syncAll();
    const timer = window.setInterval(syncAll, SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isEnterprise]);
}
