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

import { useCallback, useEffect, useRef } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { ipcBridge } from '@/common';
import { isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import { ENTERPRISE_RESOURCES_MARKER } from '@renderer/utils/enterprise/teamSkillSync';
import { isElectronDesktop } from '@renderer/utils/platform';
import { addEventListener } from '@renderer/utils/emitter';
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
  syncEnterpriseUpstream,
} from '@renderer/utils/enterprise/teamSkillSync';
import { fulfilAuditUploadRequests } from '@renderer/utils/enterprise/conversationShare';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Whether the local backend still holds model channels the company issued.
 *
 * `managed_by === 'enterprise'` is set by the backend when it materializes a
 * company channel and is the same marker its own purge deletes on, so this asks
 * exactly the question the purge answers. Unreachable backend → `false`: a
 * failed probe must not be read as "nothing to clean", but it must not stall
 * personal mode either, and the marker path still covers the ordinary case.
 */
async function backendHoldsCompanyProviders(): Promise<boolean> {
  try {
    const providers = (await ipcBridge.mode.listProviders.invoke()) ?? [];
    return providers.some((p) => p.managed_by === 'enterprise');
  } catch {
    return false;
  }
}

export function useTeamResourceSync(): void {
  const { t } = useTranslation();
  const { context, loading } = useOrgContext();
  const isEnterprise = context?.isEnterprise ?? false;
  /** Whether the previous render resolved as enterprise — see the purge below. */
  const wasEnterprise = useRef(false);

  /**
   * Take back the company's materialized resources, on evidence rather than on
   * a remembered flag.
   *
   * The marker alone used to be the whole trigger, and it failed both ways.
   *
   * It could be missing while the resources are not: rows written by a build
   * from before the marker existed, a cleared site storage, a different
   * renderer profile. The machine then held enterprise-issued model channels —
   * complete with the company's API key, visible in the personal workspace's
   * model list under an 「企业下发」 badge — with nothing left that could ever
   * decide to remove them. That is how a leaked key outlives the membership.
   *
   * And it was consumed before the work it guarded had happened: the marker was
   * removed, then a fire-and-forget purge was started. A purge that failed took
   * its own retry with it.
   *
   * So: ask the backend, which is where the answer actually lives, and clear
   * the marker only once the purge has come back. The marker stays as the cheap
   * path — it answers without a round trip in the common case — but it is no
   * longer the only evidence that counts.
   */
  const purgeMaterializedEnterpriseResources = useCallback(async () => {
    try {
      if (!localStorage.getItem(ENTERPRISE_RESOURCES_MARKER) && !(await backendHoldsCompanyProviders())) {
        return;
      }
      await clearTeamResources();
      localStorage.removeItem(ENTERPRISE_RESOURCES_MARKER);
    } catch {
      // Keep the marker: leaving it set means the next personal-mode start
      // tries again, which is the failure mode worth having.
    }
  }, []);

  // C1-2: `teamSkillSync.ts` is a plain module with no React/i18n context, so
  // it emits this event (at most once per sync cycle — see the emit site)
  // instead of showing the message itself.
  useEffect(() => {
    return addEventListener('enterprise.machineBlocked', () => {
      Message.warning(t('settings.enterpriseMachineBlockedNotice'));
    });
  }, [t]);

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
    if (loading) return;
    if (!isEnterprise && wasEnterprise.current) {
      wasEnterprise.current = false;
      void purgeMaterializedEnterpriseResources();
      return;
    }
    if (!isEnterprise) {
      // Leaving BY WAY OF A RELOAD: the disconnect toggle disables enterprise
      // mode and reloads the app, so the in-memory leaving transition above
      // never sees it — a fresh mount has no "was enterprise" to compare
      // against, and an enterprise-issued model channel survived the switch
      // back to the personal workspace exactly that way.
      //
      // Gated on enterprise mode being explicitly OFF. A server that is
      // merely unreachable keeps enabled=true, and its offline cache must
      // stay — an unreachable server must never read as a purge instruction.
      if (!isEnterpriseModeEnabled() && isElectronDesktop()) {
        void purgeMaterializedEnterpriseResources();
      }
      return;
    }
    // standalone, or a browser thin-client → never sync
    if (!isEnterprise || !isElectronDesktop()) return;
    localStorage.setItem(ENTERPRISE_RESOURCES_MARKER, '1');
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
      // C0-1 plan A: the company-server channel the terminal-approval gate
      // drives. A credential push, not a state sync — idempotent, and
      // `clearTeamResources` (revocation) is what empties it again.
      void syncEnterpriseUpstream();
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
  }, [isEnterprise, loading]);
}
