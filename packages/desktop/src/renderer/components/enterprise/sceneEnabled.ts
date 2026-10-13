/**
 * Copyright 2026 One Work
 */

/**
 * Which of their enterprise scenes a member has switched off.
 *
 * The company decides which scenes a member carries; whether a member wants to
 * use one is theirs, so — like the order (see `sceneOrder`) — it is a
 * per-viewer preference kept in this browser, keyed by server, project group
 * and member. What is stored is the *off* set: a scene the company adds later
 * is on until the member says otherwise, and a scene the member never touched
 * needs no entry. It can come back empty (private window, cleared data), in
 * which case every scene is on.
 */

import type { SceneOrderScope } from './sceneOrder';

const KEY_PREFIX = 'one-enterprise:scene-off:';

const storageKey = (scope: SceneOrderScope): string =>
  `${KEY_PREFIX}${scope.server ?? ''}|${scope.tenantId}|${scope.userId ?? ''}`;

export function loadDisabledScenes(scope: SceneOrderScope): string[] {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDisabledScenes(scope: SceneOrderScope, disabled: string[]): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(disabled));
  } catch {
    // A preference that cannot be kept is a preference lost, not an error to show.
  }
}

/** `disabled` with `sceneId` switched on or off. Never lists an id twice. */
export function setSceneEnabled(disabled: string[], sceneId: string, enabled: boolean): string[] {
  const rest = disabled.filter((id) => id !== sceneId);
  return enabled ? rest : [...rest, sceneId];
}
