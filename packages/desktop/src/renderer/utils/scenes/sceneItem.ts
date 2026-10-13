/**
 * Copyright 2026 One Work
 */

/**
 * One scene as the home page and the scenes tab see it, whoever made it.
 *
 * A company scene (issued by an administrator, read-only to the member) and a
 * personal one (made by the member, kept on this machine) differ in where they
 * come from and what can be done to them, not in what they are: a name, a
 * picture, a bundle of resources and a way of starting work. This is the shape
 * both are reduced to for display, ordering and switching on and off; the
 * original is kept for opening a conversation.
 */

import type { MyScene } from '@/common/types/platform/enterpriseTypes';
import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { personalSceneKey } from './personalScenes';
import { sceneAvatarSrc } from './sceneAvatar';

export type SceneItemResource = { resourceType: string; count: number; includesAll: boolean };

export type SceneItem = {
  /** Unique across both kinds; what order and on/off preferences are stored by. */
  key: string;
  source: 'company' | 'mine';
  name: string;
  description: string;
  /** A picture (company scenes), or `undefined` when `icon` stands in for one. */
  imageSrc?: string;
  /** An emoji (personal scenes). */
  icon?: string;
  resources: SceneItemResource[];
  /** Example first sentences, for the tooltip and the editor. */
  starters: string[];
  company?: MyScene;
  mine?: PersonalScene;
};

export function companySceneItem(scene: MyScene): SceneItem {
  return {
    key: scene.id,
    source: 'company',
    name: scene.name,
    description: scene.description ?? '',
    imageSrc: sceneAvatarSrc(scene),
    resources: scene.resources.map(({ resourceType, count, includesAll }) => ({ resourceType, count, includesAll })),
    starters: scene.intent?.discovery ? scene.intent.starters : [],
    company: scene,
  };
}

export function personalSceneItem(scene: PersonalScene): SceneItem {
  const resources: SceneItemResource[] = [];
  if (scene.skillNames.length > 0) {
    resources.push({ resourceType: 'skill', count: scene.skillNames.length, includesAll: false });
  }
  if (scene.mcpServerIds.length > 0) {
    resources.push({ resourceType: 'mcp', count: scene.mcpServerIds.length, includesAll: false });
  }
  return {
    key: personalSceneKey(scene.id),
    source: 'mine',
    name: scene.name,
    description: scene.description,
    icon: scene.icon,
    resources,
    starters: scene.intent.discovery ? scene.intent.starters : [],
    mine: scene,
  };
}
