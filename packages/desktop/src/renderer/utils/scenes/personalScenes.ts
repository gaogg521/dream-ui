/**
 * Copyright 2026 One Work
 */

/**
 * The scenes a person makes for themselves.
 *
 * Company scenes come from an administrator and live on the company server;
 * these live on this machine, in the app's own settings store, so they work for
 * everyone — a company member who wants a scene the company has not issued, and
 * a person on a stand-alone install with no company at all. Reading is
 * forgiving (anything that does not look like a scene is dropped, not a reason
 * to lose the rest); writing is whole-list, so the list is read, changed here
 * and written back.
 */

import { ConfigStorage } from '@/common/config/storage';
import {
  SCENE_LIMITS,
  emptySceneIntent,
  type PersonalScene,
  type SceneIntent,
} from '@/common/types/platform/sceneTypes';

/** Pictures a person can pick for a scene. */
export const SCENE_ICONS = ['🧭', '🌐', '📊', '✍️', '🗒️', '💼', '🛠️', '🎨', '📣', '⚖️', '🧪', '🤖'] as const;

const DEFAULT_ICON = SCENE_ICONS[0];

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const textList = (value: unknown, maxItems: number, maxLength: number): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => text(item, maxLength))
        .filter((item) => item.length > 0)
        .slice(0, maxItems)
    : [];

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
    : [];

export function normalizeIntent(value: unknown): SceneIntent {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof SceneIntent, unknown>>;
  const base = emptySceneIntent();
  return {
    // A scene stored without the flag asks questions first: that is the point of a scene.
    discovery: typeof raw.discovery === 'boolean' ? raw.discovery : base.discovery,
    starters: textList(raw.starters, SCENE_LIMITS.starters, SCENE_LIMITS.starter),
    questions: textList(raw.questions, SCENE_LIMITS.questions, SCENE_LIMITS.question),
    constraints: text(raw.constraints, SCENE_LIMITS.constraints),
    deliverables: text(raw.deliverables, SCENE_LIMITS.deliverables),
  };
}

/** A scene read back from storage, or `null` when it is unusable (no id or no name). */
export function normalizePersonalScene(value: unknown): PersonalScene | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, 80);
  const name = text(raw.name, SCENE_LIMITS.name);
  if (!id || !name) return null;
  const now = Date.now();
  return {
    id,
    name,
    description: text(raw.description, SCENE_LIMITS.description),
    icon: text(raw.icon, 8) || DEFAULT_ICON,
    prompt: text(raw.prompt, SCENE_LIMITS.prompt),
    intent: normalizeIntent(raw.intent),
    skillNames: stringList(raw.skillNames),
    mcpServerIds: stringList(raw.mcpServerIds),
    templateId: typeof raw.templateId === 'string' ? raw.templateId : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

/** The key a personal scene goes by next to company scenes, which have their own id space. */
export const personalSceneKey = (id: string): string => `mine:${id}`;

export function newPersonalScene(
  seed: Partial<Omit<PersonalScene, 'id' | 'createdAt' | 'updatedAt'>> = {}
): PersonalScene {
  const now = Date.now();
  return {
    id: `pscene_${globalThis.crypto?.randomUUID?.() ?? `${now}${Math.random().toString(16).slice(2)}`}`,
    name: seed.name ?? '',
    description: seed.description ?? '',
    icon: seed.icon ?? DEFAULT_ICON,
    prompt: seed.prompt ?? '',
    intent: seed.intent ?? emptySceneIntent(),
    skillNames: seed.skillNames ?? [],
    mcpServerIds: seed.mcpServerIds ?? [],
    templateId: seed.templateId,
    createdAt: now,
    updatedAt: now,
  };
}

/** `list` with `scene` added, or replacing the one with its id. */
export function upsertPersonalScene(list: PersonalScene[], scene: PersonalScene): PersonalScene[] {
  const stamped = { ...scene, updatedAt: Date.now() };
  return list.some((item) => item.id === scene.id)
    ? list.map((item) => (item.id === scene.id ? stamped : item))
    : [...list, stamped];
}

export const removePersonalScene = (list: PersonalScene[], id: string): PersonalScene[] =>
  list.filter((item) => item.id !== id);

/** Why a scene cannot be saved yet, as message keys; empty when it can. */
export function personalSceneProblems(scene: PersonalScene): Array<'nameRequired'> {
  return scene.name.trim().length === 0 ? ['nameRequired'] : [];
}

export async function loadPersonalScenes(): Promise<PersonalScene[]> {
  try {
    const stored = await ConfigStorage.get('scenes.personal');
    return Array.isArray(stored)
      ? stored.map(normalizePersonalScene).filter((scene): scene is PersonalScene => scene !== null)
      : [];
  } catch {
    return [];
  }
}

export async function savePersonalScenes(list: PersonalScene[]): Promise<void> {
  await ConfigStorage.set('scenes.personal', list);
}
