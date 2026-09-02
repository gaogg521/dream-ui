/**
 * M3 — team skill sync (renderer side).
 *
 * Pulls the member's visible team skills from the (possibly remote) one-devops
 * registry and materializes them onto the LOCAL backend disk, so they survive
 * server outages (offline-first) and are picked up by the normal skill loader.
 *
 * ADDITIVE / standalone-safe: callers must gate on being in an enterprise
 * context (a resolved tenant). In standalone mode this is never invoked, so no
 * `team-sync` request is issued and no team-skills directory is ever created.
 */

import { ipcBridge } from '@/common';
import type { DlpFindingInput } from '@/common/adapter/ipcBridge';
import { getEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';

export type TeamSkillSyncResult = { written: number; removed: number; kept: number };

/**
 * Fetch team skills from the registry, then materialize + reconcile locally.
 *
 * - Registry fetch fails (server unreachable) → returns null and does NOT
 *   touch the local cache (offline-first: cached team skills stay usable).
 * - Registry fetch succeeds → posts the full set as `authoritative`, so the
 *   local backend reconciles server-side deletions.
 */
export async function syncTeamSkills(): Promise<TeamSkillSyncResult | null> {
  let registrySkills: Awaited<ReturnType<typeof ipcBridge.oneDevops.listSkills.invoke>>;
  try {
    registrySkills = await ipcBridge.oneDevops.listSkills.invoke();
  } catch {
    // Server unreachable — keep the local cache untouched.
    return null;
  }

  const skills = (registrySkills ?? [])
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      content: s.content ?? '',
      autoActive: s.autoActive ?? false,
    }));

  try {
    const report = await ipcBridge.fs.syncTeamSkills.invoke({ skills, authoritative: true });
    return { written: report.written.length, removed: report.removed.length, kept: report.kept };
  } catch {
    return null;
  }
}

/**
 * Same contract for team MCP connectors: fetch the registry (remote in client
 * mode), then materialize into the LOCAL MCP config. Server unreachable →
 * null, local cache untouched (offline-first). Personal servers with the same
 * name are never clobbered (backend conflict guard).
 */
export async function syncTeamMcp(): Promise<TeamSkillSyncResult | null> {
  let registry: Awaited<ReturnType<typeof ipcBridge.oneDevops.listMcpRegistry.invoke>>;
  try {
    registry = await ipcBridge.oneDevops.listMcpRegistry.invoke();
  } catch {
    return null;
  }

  const servers = (registry ?? [])
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      endpoint: s.endpoint ?? '',
      enabled: s.enabled,
      secretsJson: s.secretsJson ?? undefined,
    }));

  try {
    const report = await ipcBridge.fs.syncTeamMcp.invoke({ servers, authoritative: true });
    return { written: report.written.length, removed: report.removed.length, kept: report.kept };
  } catch {
    return null;
  }
}

/**
 * Same contract again for company model channels — with one addition that the
 * other two do not need: a **token per channel**.
 *
 * The company's real API key never leaves the server. What lands here is a
 * revocable token that identifies this member at the company's model proxy, and
 * the provider row we write points at that proxy rather than at the vendor. So
 * a member gets working image / video / chat models without ever holding a
 * credential, and an admin can cut them off by revoking one row.
 *
 * Offline-first like the others: a registry we could not read leaves the local
 * providers untouched, because a member whose company server is briefly down
 * should not watch their models disappear.
 */
export async function syncTeamModelChannels(): Promise<TeamSkillSyncResult | null> {
  let channels: Awaited<ReturnType<typeof ipcBridge.oneDevops.listModelChannels.invoke>>;
  try {
    channels = await ipcBridge.oneDevops.listModelChannels.invoke();
  } catch {
    return null;
  }

  const serverUrl = getEnterpriseServerUrl();
  if (!serverUrl) {
    // No company server means no proxy to point at. Writing a provider whose
    // base URL we had to guess would produce a channel that fails at call time
    // for a reason the user could not act on.
    return null;
  }

  const enabled = (channels ?? []).filter((channel) => channel.enabled);

  // A token per channel, minted for this member. Failures are per-channel on
  // purpose: one channel the member is not entitled to must not cost them the
  // others.
  const resolved = await Promise.all(
    enabled.map(async (channel) => {
      try {
        const issued = await ipcBridge.oneDevops.issueChannelToken.invoke({ id: channel.id });
        return {
          channelId: channel.id,
          name: channel.name,
          platform: channel.platform,
          baseUrl: `${serverUrl}/api/one/model-proxy/${channel.id}`,
          token: issued.token,
          models: parseJsonOr<string[]>(channel.models, []),
          modelSettings: parseJsonOr<unknown>(channel.modelSettings, undefined),
          modelProtocols: parseJsonOr<unknown>(channel.modelProtocols, undefined),
        };
      } catch {
        return null;
      }
    })
  );

  const usable = resolved.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // Authoritative only when every channel resolved. If a token request failed,
  // this is not the complete set, and reconciling against it would delete a
  // channel the member still has — the exact mistake the offline-first rule
  // exists to prevent, just one level further in.
  const authoritative = usable.length === enabled.length;

  try {
    const report = await ipcBridge.mode.syncModelChannels.invoke({ channels: usable, authoritative });
    return {
      written: report.written.length,
      removed: report.removed.length,
      kept: report.conflicts.length,
    };
  } catch {
    return null;
  }
}

function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Purge every locally-materialized team resource. Called after a member leaves
 * the enterprise so their agent stops auto-loading team skills and connecting
 * to team MCP servers (D2). An authoritative sync with an empty payload set
 * reconciles away all `.team-origin` / team-registry-owned entries while
 * leaving the member's personal skills and servers untouched.
 *
 * Company model channels go too: a member who left must not keep calling the
 * company's models. Their tokens are revoked server-side as well, so this is
 * belt-and-braces — but it is what makes the local state stop *looking* like
 * they still have access.
 *
 * ⚠️ Content rules must go too, and this one is not belt-and-braces. Nothing
 * server-side stops an already-distributed rule: it lives in the local backend
 * until something replaces it. A member who left would keep having sends
 * refused by their ex-employer's policy, on a screen that no longer exists to
 * explain why.
 *
 * Undelivered findings are dropped rather than flushed. Reporting them races
 * the session being invalidated by the leave, so the call would usually fail;
 * code that pretends to deliver them would be worse than admitting it does not.
 */
export async function clearTeamResources(): Promise<void> {
  undeliveredFindings = [];
  await Promise.allSettled([
    ipcBridge.fs.syncTeamSkills.invoke({ skills: [], authoritative: true }),
    ipcBridge.fs.syncTeamMcp.invoke({ servers: [], authoritative: true }),
    ipcBridge.mode.syncModelChannels.invoke({ channels: [], authoritative: true }),
    ipcBridge.mode.setContentInspectionRules.invoke({ rules: [] }),
  ]);
}

/**
 * Findings that were drained locally but could not be delivered upstream.
 *
 * Draining empties the backend's buffer, so a failed report would otherwise
 * lose them outright. Holding them here covers the common case — the server
 * was briefly unreachable — without needing an acknowledgement protocol.
 * Bounded, and lost on reload: this is best-effort delivery, not a queue.
 */
let undeliveredFindings: DlpFindingInput[] = [];
const MAX_UNDELIVERED = 500;

export type ContentInspectionSyncResult = { rules: number; findingsReported: number };

/**
 * Distribute the company's content rules to this machine, and ship back the
 * findings it recorded (T4).
 *
 * Direction matters in both halves:
 * - Rules come from the governance backend and are written to the LOCAL one,
 *   because the check runs where the prompt is assembled.
 * - A failed rule fetch leaves the local set untouched. Clearing it would turn
 *   an unreachable server into a silently disabled policy — the worst of the
 *   three possible outcomes, because nothing looks wrong.
 */
export async function syncContentInspection(): Promise<ContentInspectionSyncResult | null> {
  let rules: Awaited<ReturnType<typeof ipcBridge.oneDevops.listMyDlpRules.invoke>>;
  try {
    rules = await ipcBridge.oneDevops.listMyDlpRules.invoke();
  } catch {
    return null;
  }

  // An empty list is authoritative, not a failure: the admin may have deleted
  // every rule, and that has to actually stop enforcement.
  const local = (rules ?? []).map((rule) => ({
    id: rule.id,
    name: rule.name,
    matcher: rule.matcher,
    pattern: rule.pattern,
    action: rule.action,
  }));

  let activeRules = 0;
  try {
    const report = await ipcBridge.mode.setContentInspectionRules.invoke({ rules: local });
    activeRules = report.activeRules;
  } catch {
    return null;
  }

  const findingsReported = await reportPendingFindings();
  return { rules: activeRules, findingsReported };
}

async function reportPendingFindings(): Promise<number> {
  let drained: DlpFindingInput[] = [];
  try {
    drained = (await ipcBridge.mode.drainContentInspectionFindings.invoke()) ?? [];
  } catch {
    // The local backend is not answering; whatever it holds stays held.
    drained = [];
  }

  const outgoing = [...undeliveredFindings, ...drained];
  if (outgoing.length === 0) return 0;

  try {
    await ipcBridge.oneDevops.reportDlpEvents.invoke({ events: outgoing });
    undeliveredFindings = [];
    return outgoing.length;
  } catch {
    // Keep the newest — same reasoning as the backend's own buffer bound.
    undeliveredFindings = outgoing.slice(-MAX_UNDELIVERED);
    return 0;
  }
}
