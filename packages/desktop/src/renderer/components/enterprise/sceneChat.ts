/**
 * Copyright 2026 One Work
 */

/**
 * Opening a conversation from an enterprise scene.
 *
 * A scene is what an administrator set up for a role: a prompt, and a package
 * of skills and tools. Clicking one on the home page should land the member in
 * a conversation that already has those — not leave them on a page that only
 * describes them. The conversation is a plain dream conversation whose extra
 * carries the scene's prompt as standing rules and its skills as the initial
 * skill set, which are the same inputs the home composer already sends.
 *
 * Skills and connectors are named by company registry id in the scene; on a
 * member's machine only the team sync's local copies exist, so each id is
 * resolved to the local one it was materialized as. Anything that has not
 * synced (yet) is left out rather than failing the click.
 */

import { ipcBridge } from '@/common';
import type { TProviderWithModel } from '@/common/config/storage';
import type { MyScene } from '@/common/types/platform/enterpriseTypes';

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
    /** The scene's prompt, as the conversation's standing rules. */
    preset_rules: string;
    /** Local skill names the conversation starts with. */
    enabled_skills: string[];
    /** Which scene this was opened from; display and diagnostics only. */
    scene_id: string;
  };
};

/** `[A-Za-z0-9_-]` is all the team sync keeps of a registry id in a directory name. */
const sanitizeRegistryId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '');

/**
 * The text the conversation starts from: the administrator's prompt, or — when
 * none was written — what the scene's own fields say about it.
 */
export function buildScenePrompt(scene: Pick<MyScene, 'name' | 'description' | 'prompt' | 'jobFunctions'>): string {
  const written = scene.prompt?.trim();
  if (written) return written;

  const lines = [`You are working in the enterprise scene "${scene.name}".`];
  const description = scene.description?.trim();
  if (description) lines.push(`About this scene: ${description}`);
  const functions = scene.jobFunctions.map((item) => item.trim()).filter(Boolean);
  if (functions.length > 0) lines.push(`Roles it covers: ${functions.join(', ')}.`);
  lines.push('Use the skills and tools attached to this conversation when they fit the task.');
  return lines.join('\n');
}

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

export function buildSceneConversationRequest(params: {
  scene: MyScene;
  skills: LocalSkill[];
  model: TProviderWithModel;
}): SceneConversationRequest {
  const { scene, skills, model } = params;
  return {
    type: 'dream',
    name: scene.name,
    model,
    extra: {
      workspace: '',
      custom_workspace: false,
      preset_rules: buildScenePrompt(scene),
      enabled_skills: resolveSceneSkillNames(scene, skills),
      scene_id: scene.id,
    },
  };
}

/** Create the scene's conversation and return its id, or `null` when the backend declined. */
export async function startSceneConversation(scene: MyScene, model: TProviderWithModel): Promise<string | null> {
  const skills = await ipcBridge.fs.listAvailableSkills
    .invoke()
    .then((rows) => rows.map(({ name, location, source }): LocalSkill => ({ name, location, source })))
    // A scene whose skills cannot be read still opens: the prompt and the
    // connectors the team sync loads everywhere do not depend on them.
    .catch((): LocalSkill[] => []);
  const conversation = await ipcBridge.conversation.create.invoke(
    buildSceneConversationRequest({ scene, skills, model })
  );
  return conversation?.id ?? null;
}
