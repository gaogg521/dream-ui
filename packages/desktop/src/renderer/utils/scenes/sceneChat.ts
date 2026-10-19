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
import type { TProviderWithModel } from '@/common/config/storage';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { buildSceneRules } from './sceneProtocol';
import type { SceneItem } from './sceneItem';

/** The slice of `ipcBridge.fs.listAvailableSkills` rows this needs. */
export type LocalSkill = { name: string; location: string; source?: string };

/** The conversation-create payload for a scene (media-style dream conversation). */
export type SceneConversationRequest = {
  type: 'dream';
  name: string;
  model: TProviderWithModel;
  extra: {
    workspace: string;
    custom_workspace: false;
    /** The scene's standing rules: role, working method, hard rules, acceptance. */
    preset_rules: string;
    /** Local skill names the conversation starts with. */
    enabled_skills: string[];
    /** Local MCP server ids the conversation is limited to; absent means "whatever is enabled". */
    selected_mcp_server_ids?: string[];
    /** Which scene this was opened from; display and diagnostics only. */
    scene_id: string;
    /** The scene's example openers, offered as chips until the conversation begins. */
    scene_starters?: string[];
    /** What the empty conversation shows (see `SceneGreeting`). */
    scene_greeting?: SceneGreeting;
  };
};

/** The slice of a local MCP server row this needs. */
export type LocalMcpServer = { id: string; name?: string; original_json?: string };

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
}): SceneConversationRequest {
  const { item, skills, mcpServers = [], model } = params;
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
    workspace: '',
    custom_workspace: false,
    preset_rules: rules,
    enabled_skills: company
      ? resolveSceneSkillNames(company, skills)
      : mine
        ? resolvePersonalSkillNames(mine, skills)
        : [],
    scene_id: item.key,
  };
  if (mine && mine.mcpServerIds.length > 0) extra.selected_mcp_server_ids = mine.mcpServerIds;
  // A company scene that grants connectors limits the conversation to those that
  // are here; if none have synced yet it limits nothing rather than leaving the
  // conversation with no tools at all.
  if (company) {
    const resolved = resolveSceneMcpServerIds(company, mcpServers);
    if (resolved.length > 0) extra.selected_mcp_server_ids = resolved;
  }
  if (item.starters.length > 0) extra.scene_starters = item.starters;
  const intent = company ? company.intent : mine?.intent;
  const asksFirst = Boolean(intent?.discovery);
  const role = summarizeRole(company ? company.prompt : mine?.prompt) ?? summarizeRole(item.description);
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
    skills: extra.enabled_skills,
    tools: (extra.selected_mcp_server_ids ?? []).flatMap((id) => {
      const name = mcpServers.find((server) => server.id === id)?.name;
      return name ? [name] : [];
    }),
    asksFirst,
    ...(role ? { role } : {}),
    ...(hardRules.length > 0 ? { rules: hardRules } : {}),
    ...(deliverables ? { deliverables } : {}),
  };
  return { type: 'dream', name: item.name, model, extra };
}

/** Create the scene's conversation and return its id, or `null` when the backend declined. */
export async function startSceneConversation(item: SceneItem, model: TProviderWithModel): Promise<string | null> {
  const skills = await ipcBridge.fs.listAvailableSkills
    .invoke()
    .then((rows) => rows.map(({ name, location, source }): LocalSkill => ({ name, location, source })))
    // A scene whose skills cannot be read still opens: the rules and the
    // connectors the team sync loads everywhere do not depend on them.
    .catch((): LocalSkill[] => []);
  // The local MCP rows are needed to resolve a company scene's connectors, and to name the
  // servers a personal scene limits the conversation to.
  const needsServers = Boolean(item.company?.mcpIds?.length || item.mine?.mcpServerIds.length);
  const mcpServers = needsServers
    ? await ensureBackendMcpCatalog()
        .then(({ allServers }) =>
          allServers.map(({ id, name, original_json }): LocalMcpServer => ({ id, name, original_json }))
        )
        .catch((): LocalMcpServer[] => [])
    : [];
  const conversation = await ipcBridge.conversation.create.invoke(
    buildSceneConversationRequest({ item, skills, mcpServers, model })
  );
  return conversation?.id ?? null;
}
