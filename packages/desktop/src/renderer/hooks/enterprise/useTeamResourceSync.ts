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

import { useEffect, useRef } from 'react';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { isElectronDesktop } from '@renderer/utils/platform';
import {
  clearTeamResources,
  syncContentInspection,
  syncTeamAgents,
  syncTeamMcp,
  syncTeamModelChannels,
  syncTeamSkills,
  syncTeamMemory,
  syncSendPolicy,
  syncToolSecurityPolicy,
} from '@renderer/utils/enterprise/teamSkillSync';
import { fulfilAuditUploadRequests } from '@renderer/utils/enterprise/conversationShare';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function useTeamResourceSync(): void {
  const { context } = useOrgContext();
  const isEnterprise = context?.isEnterprise ?? false;
  /** Whether the previous render resolved as enterprise — see the purge below. */
  const wasEnterprise = useRef(false);

  useEffect(() => {
    // Leaving the enterprise is the one unambiguous "you are out" signal this
    // client gets. The registry fetches can only guess from a status code, and
    // 401 is too weak to guess on (an enterprise-server restart invalidates
    // every token at once, which would otherwise purge every member's team
    // resources). Purging here instead needs no guess: the org context has
    // stopped resolving as enterprise.
    //
    // Guarded on the TRANSITION, not the state: a standalone user who was
    // never in an enterprise has nothing to purge, and firing four IPC calls
    // on every personal-mode start would be pure noise.
    if (!isEnterprise && wasEnterprise.current) {
      wasEnterprise.current = false;
      void clearTeamResources();
      return;
    }
    // standalone, or a browser thin-client → never sync
    if (!isEnterprise || !isElectronDesktop()) return;
    wasEnterprise.current = true;
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
      // The other half of the same policy: content inspection decides what may
      // be *sent*, this decides what tools may *run*. Both are enforced on this
      // machine because that is where both happen, and both therefore inherit
      // the same up-to-one-cycle propagation delay.
      void syncToolSecurityPolicy();
      // And the third: what may be *sent*, and with which model. Same machine,
      // same reason, same propagation delay.
      void syncSendPolicy();
      // Company memory, for the same reason and on the same terms: recall runs
      // against the local copy so the prompt never has to leave the machine.
      void syncTeamMemory();
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
