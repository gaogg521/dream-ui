/**
 * Copyright 2026 One Work
 */

/**
 * Opening a conversation from a scene, whoever made it.
 *
 * Clicking a scene on the home page should land the person in a conversation
 * that already has what the scene carries — not leave them on a page that only
 * describes it. The conversation is a plain dream conversation whose extra
 * carries the scene's standing rules (role, working method, hard rules, see
 * `sceneProtocol`) and its skills as the initial skill set, which are the same
 * inputs the home composer already sends.
 *
 * A company scene names its skills by company registry id; on a member's
 * machine only the team sync's local copies exist, so each id is resolved to the
 * local one it was materialized as. A personal scene names local skills
 * directly, and may limit the conversation to some MCP servers. Anything that
 * is not there (not synced yet, since uninstalled) is left out rather than
 * failing the click.
 */

import { ipcBridge } from '@/common';
import { ensureBackendMcpCatalog } from '@/renderer/hooks/mcp/catalog';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { loadLatestConversationMessages } from '@/renderer/utils/chat/messagePagination';
import type { TProviderWithModel, IMcpServerTransport, ISessionMcpServer } from '@/common/config/storage';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { buildSceneRules } from './sceneProtocol';
import type { SceneItem } from './sceneItem';
import i18next from 'i18next';

/** The slice of `ipcBridge.fs.listAvailableSkills` rows this needs. */
export type LocalSkill = { name: string; location: string; source?: string; displayName?: string };

const BUILTIN_TOOL_LABELS = {
  'one-browser': 'common.scenes.bundledTools.browser',
  'one-page-reader': 'common.scenes.bundledTools.pageReader',
  'one-export-pdf': 'common.scenes.bundledTools.pdf',
  'one-html-render': 'common.scenes.bundledTools.image',
} as const;

/** The conversation-create payload for a scene (media-style dream conversation). */
export type SceneConversationRequest = {
  type: 'dream';
  name: string;
  model: TProviderWithModel;
  extra: {
    /** The folder the person chose on the home page; empty means a temporary one for this conversation. */
    workspace: string;
    custom_workspace: boolean;
    /** The scene's standing rules: role, working method, hard rules, acceptance. */
    preset_rules: string;
    /** Local skill names the conversation starts with. */
    enabled_skills: string[];
    /**
     * The person's own imported skills the conversation does NOT start with. Every conversation
     * auto-loads all of them, so without this a scene that names 10 skills opens with 130.
     */
    exclude_auto_inject_skills?: string[];
    /** Explicit local MCP snapshot. Company scenes always provide this array. */
    selected_mcp_server_ids?: string[];
    selected_session_mcp_servers?: ISessionMcpServer[];
    /** Which scene this was opened from; display and diagnostics only. */
    scene_id: string;
    /** How tool requests are approved from the first message on; absent means the usual ask-each-time. */
    session_mode?: string;
    /** The scene's example openers, offered as chips until the conversation begins. */
    scene_starters?: string[];
    /** What the empty conversation shows (see `SceneGreeting`). */
    scene_greeting?: SceneGreeting;
  };
};

/** The slice of a local MCP server row this needs. */
export type LocalMcpServer = {
  id: string;
  name?: string;
  original_json?: string;
  builtin?: boolean;
  enabled?: boolean;
  transport?: IMcpServerTransport;
};

/**
 * What the conversation shows before anything is said: which scene this is, what
 * came with it, and how it will work. Written onto the conversation when it is
 * opened (`extra.scene_greeting`) and read back by `SceneGreeting`.
 */
export type SceneGreeting = {
  name: string;
  description: string;
  /** An emoji for a personal scene; company scenes show the generic mark. */
  icon?: string;
  /** Skills the scene started the conversation with. */
  skills: string[];
  /** MCP tools the conversation was limited to by name; empty when it was not limited. */
  tools: string[];
  /** Whether the scene asks before it builds. */
  asksFirst: boolean;
  /** The project folder the conversation works in; absent when it uses its own temporary one. */
  workspace?: string;
  /** Who the assistant is in this scene (the written role, shortened). */
  role?: string;
  /** The hard rules that apply at every step (only injected when the scene asks first). */
  rules?: string[];
  /** What the scene hands over (only injected when the scene asks first). */
  deliverables?: string;
};

/** The leading "1." / "2)" of a numbered rule line is list chrome, not content. */
const stripListMarker = (line: string): string => line.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '').trim();

/** One line of what a role says, for a greeting: enough to recognise it, not the whole prompt. */
const summarizeRole = (text: string | null | undefined, maxLength = 160): string | undefined => {
  const first = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) return undefined;
  return first.length > maxLength ? `${first.slice(0, maxLength)}...` : first;
};

/** `[A-Za-z0-9_-]` is all the team sync keeps of a registry id in a directory name. */
const sanitizeRegistryId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '');

/** Local skill names for the scene's explicitly granted skills, in the scene's order. */
export function resolveSceneSkillNames(scene: Pick<MyScene, 'skillIds'>, skills: LocalSkill[]): string[] {
  const names: string[] = [];
  for (const registryId of scene.skillIds ?? []) {
    const segment = sanitizeRegistryId(registryId);
    if (!segment) continue;
    const local = skills.find((skill) => skill.source === 'team' && skill.location.split(/[\\/]/).includes(segment));
    if (local && !names.includes(local.name)) names.push(local.name);
  }
  return names;
}

/**
 * Local MCP server ids for the connectors a company scene grants explicitly. The
 * team sync materializes each as a local row tagged with its registry id
 * (`teamRegistryId` in the row's JSON); ones that have not synced are left out.
 */
export function resolveSceneMcpServerIds(scene: Pick<MyScene, 'mcpIds'>, servers: LocalMcpServer[]): string[] {
  const wanted = new Set(scene.mcpIds ?? []);
  if (wanted.size === 0) return [];
  const ids: string[] = [];
  for (const server of servers) {
    try {
      const registryId = (JSON.parse(server.original_json ?? '{}') as { teamRegistryId?: unknown }).teamRegistryId;
      if (typeof registryId === 'string' && wanted.has(registryId) && !ids.includes(server.id)) ids.push(server.id);
    } catch {
      // A row whose JSON cannot be read is not a team row.
    }
  }
  return ids;
}

/** The skills a personal scene still has: the ones it names that exist on this machine, in its order. */
export function resolvePersonalSkillNames(scene: Pick<PersonalScene, 'skillNames'>, skills: LocalSkill[]): string[] {
  const available = new Set(skills.map((skill) => skill.name));
  return scene.skillNames.filter((name) => available.has(name));
}

export function buildSceneConversationRequest(params: {
  item: SceneItem;
  skills: LocalSkill[];
  /** Local MCP rows, to resolve a company scene's connectors; without them such a scene limits nothing. */
  mcpServers?: LocalMcpServer[];
  model: TProviderWithModel;
  /** A project folder to work in; without one the conversation gets a temporary workspace. */
  workspace?: string;
}): SceneConversationRequest {
  const { item, skills, mcpServers = [], model } = params;
  const workspace = params.workspace?.trim() ?? '';
  const company = item.company;
  const mine = item.mine;
  const rules = buildSceneRules(
    company
      ? {
          name: company.name,
          description: company.description,
          prompt: company.prompt,
          jobFunctions: company.jobFunctions,
          starters: item.starters,
          intent: company.intent,
        }
      : {
          name: item.name,
          description: item.description,
          prompt: mine?.prompt,
          starters: item.starters,
          intent: mine?.intent,
        }
  );
  const extra: SceneConversationRequest['extra'] = {
    workspace,
    custom_workspace: workspace.length > 0,
    preset_rules: rules,
    enabled_skills: company
      ? resolveSceneSkillNames(company, skills)
      : mine
        ? resolvePersonalSkillNames(mine, skills)
        : [],
    scene_id: item.key,
  };
  // A scene that names its skills is a focused setup: the person's other imported skills stay
  // out of it (built-in ones the app itself relies on are not touched). A scene that names none
  // keeps the usual defaults.
  const sceneSkills = new Set(extra.enabled_skills);
  if (sceneSkills.size > 0) {
    const leftOut = [
      ...new Set(
        skills.filter((skill) => skill.source === 'custom' && !sceneSkills.has(skill.name)).map((s) => s.name)
      ),
    ];
    if (leftOut.length > 0) extra.exclude_auto_inject_skills = leftOut;
  }
  if (mine && mine.mcpServerIds.length > 0) extra.selected_mcp_server_ids = mine.mcpServerIds;
  if (mine?.builtinMcpNames?.length) {
    const bundled = mcpServers.filter(
      (server) => server.builtin && server.enabled !== false && mine.builtinMcpNames?.includes(server.name ?? '')
    );
    extra.selected_mcp_server_ids = [...new Set([...mine.mcpServerIds, ...bundled.map((server) => server.id)])];
    extra.selected_session_mcp_servers = bundled.flatMap((server) =>
      server.name && server.transport ? [{ id: server.id, name: server.name, transport: server.transport }] : []
    );
  }
  // Company scenes never fall back to unrelated globally enabled connectors.
  // Opening a scene resolves and validates its required connectors first.
  if (company) {
    const resolved = resolveSceneMcpServerIds(company, mcpServers);
    extra.selected_mcp_server_ids = resolved;
  }
  // A scene the person owns can start in the approval mode they chose for it. A company scene never
  // does: how tools are approved there is the company's policy, not the scene's.
  if (mine?.permissionMode && mine.permissionMode !== 'default') extra.session_mode = mine.permissionMode;
  if (item.starters.length > 0) extra.scene_starters = item.starters;
  const intent = company ? company.intent : mine?.intent;
  const asksFirst = Boolean(intent?.discovery);
  const role =
    (mine?.templateId?.startsWith('builtin-') ? summarizeRole(item.description) : undefined) ??
    summarizeRole(company ? company.prompt : mine?.prompt) ??
    summarizeRole(item.description);
  // Hard rules and the hand-over only reach the conversation when the scene asks
  // first (see `buildSceneRules`), so only then does the greeting claim them.
  const hardRules = asksFirst
    ? (intent?.constraints ?? '')
        .split(/\r?\n/)
        .map(stripListMarker)
        .filter((line) => line.length > 0)
    : [];
  const deliverables = asksFirst ? intent?.deliverables.trim() : undefined;
  extra.scene_greeting = {
    name: item.name,
    description: item.description,
    ...(item.icon ? { icon: item.icon } : {}),
    skills: extra.enabled_skills.map((name) => skills.find((skill) => skill.name === name)?.displayName || name),
    tools: (extra.selected_mcp_server_ids ?? []).flatMap((id) => {
      const name = mcpServers.find((server) => server.id === id)?.name;
      const label = name ? BUILTIN_TOOL_LABELS[name as keyof typeof BUILTIN_TOOL_LABELS] : undefined;
      return name ? [label ? i18next.t(label, { defaultValue: name }) || name : name] : [];
    }),
    asksFirst,
    ...(workspace ? { workspace } : {}),
    ...(role ? { role } : {}),
    ...(hardRules.length > 0 ? { rules: hardRules } : {}),
    ...(deliverables ? { deliverables } : {}),
  };
  return { type: 'dream', name: item.name, model, extra };
}

const REUSE_KEY_PREFIX = 'one-work:scene-empty-conversation:';

type ReusableRecord = { id: string; fingerprint: string };

/**
 * What makes two openings of a scene the same conversation: the standing rules, the starting
 * skills and tools, the folder and the model. If the scene was edited, a folder picked or the
 * model switched since the last opening, the fingerprint differs and nothing is reused.
 */
export function sceneFingerprint(request: SceneConversationRequest): string {
  const { extra } = request;
  return JSON.stringify([
    extra.preset_rules,
    extra.enabled_skills,
    extra.selected_mcp_server_ids ?? [],
    extra.selected_session_mcp_servers ?? [],
    extra.session_mode ?? '',
    extra.workspace,
    request.model.id,
    request.model.use_model,
  ]);
}

const readReusable = (sceneKey: string): ReusableRecord | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REUSE_KEY_PREFIX + sceneKey) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { id, fingerprint } = parsed as Partial<ReusableRecord>;
    return typeof id === 'string' && typeof fingerprint === 'string' ? { id, fingerprint } : null;
  } catch {
    return null;
  }
};

const writeReusable = (sceneKey: string, record: ReusableRecord | null): void => {
  try {
    if (record) localStorage.setItem(REUSE_KEY_PREFIX + sceneKey, JSON.stringify(record));
    else localStorage.removeItem(REUSE_KEY_PREFIX + sceneKey);
  } catch {
    // Reuse is an optimisation; a store that cannot be written just means a new conversation each time.
  }
};

/**
 * The scene's last conversation, when it is still an untouched one: it exists, nothing has
 * been said in it, it still carries the scene's name, and it was opened with the same rules,
 * skills, tools, folder and model as now. Any doubt (a failed lookup included) means no.
 */
async function findReusableConversation(request: SceneConversationRequest): Promise<string | null> {
  const sceneKey = request.extra.scene_id;
  const record = readReusable(sceneKey);
  if (!record) return null;
  try {
    if (record.fingerprint !== sceneFingerprint(request)) return null;
    const [conversation, messages] = await Promise.all([
      getConversationOrNull(record.id),
      loadLatestConversationMessages(record.id, { limit: 1 }),
    ]);
    if (!conversation || conversation.name !== request.name || messages.items.length > 0) {
      writeReusable(sceneKey, null);
      return null;
    }
    return record.id;
  } catch {
    return null;
  }
}

/**
 * Open the scene's conversation and return its id, or `null` when the backend declined.
 * Clicking a scene and leaving without saying anything used to leave an empty conversation per
 * click; the last untouched one is opened again instead (see `findReusableConversation`).
 */
export async function startSceneConversation(
  item: SceneItem,
  model: TProviderWithModel,
  workspace?: string
): Promise<string | null> {
  // Scene grants are an administrator's dependency selection, not another
  // manual checkbox batch. Materialize them before resolving local IDs.
  if (item.company) {
    await ipcBridge.oneDevops.activateSceneMcp.invoke({ sceneId: item.company.id });
    const { syncTeamMcp } = await import('@/renderer/utils/enterprise/teamSkillSync');
    const synced = await syncTeamMcp();
    if (!synced) return null;
  }
  // The skill list and the MCP rows are independent reads; waiting for one
  // before asking for the other put their latencies end to end on the click.
  // The MCP rows are needed to resolve a company scene's connectors, and to name
  // the servers a personal scene limits the conversation to.
  const needsServers = Boolean(
    item.company?.mcpIds?.length || item.mine?.mcpServerIds.length || item.mine?.builtinMcpNames?.length
  );
  const [skills, mcpServers] = await Promise.all([
    ipcBridge.fs.listAvailableSkills
      .invoke()
      .then((rows) =>
        rows.map(
          ({ name, location, source, display_name }): LocalSkill => ({
            name,
            location,
            source,
            displayName: display_name,
          })
        )
      )
      // A scene whose skills cannot be read still opens: the rules and the
      // connectors the team sync loads everywhere do not depend on them.
      .catch((): LocalSkill[] => []),
    needsServers
      ? ensureBackendMcpCatalog()
          .then(({ allServers }) =>
            allServers.map(
              ({ id, name, original_json, builtin, enabled, transport }): LocalMcpServer => ({
                id,
                name,
                original_json,
                builtin,
                enabled,
                transport,
              })
            )
          )
          .catch((): LocalMcpServer[] => [])
      : Promise.resolve<LocalMcpServer[]>([]),
  ]);
  const request = buildSceneConversationRequest({ item, skills, mcpServers, model, workspace });
  if (item.mine?.builtinMcpNames?.length) {
    const available = new Set(
      mcpServers
        .filter((server) => server.builtin && server.enabled !== false && server.transport)
        .map((server) => server.name)
    );
    if (
      item.mine.builtinMcpNames.some((name) => !available.has(name)) ||
      item.mine.skillNames.some((name) => !skills.some((skill) => skill.name === name))
    )
      throw new Error('SCENE_DEPENDENCY_UNAVAILABLE');
  }
  if (
    item.company?.mcpIds.length &&
    (request.extra.selected_mcp_server_ids?.length ?? 0) !== new Set(item.company.mcpIds).size
  )
    return null;
  const reusable = await findReusableConversation(request);
  if (reusable) return reusable;
  const conversation = await ipcBridge.conversation.create.invoke(request);
  if (conversation?.id)
    writeReusable(request.extra.scene_id, { id: conversation.id, fingerprint: sceneFingerprint(request) });
  return conversation?.id ?? null;
}
