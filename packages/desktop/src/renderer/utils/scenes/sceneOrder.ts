/**
 * Copyright 2026 One Work
 */

/**
 * The member's own ordering of their enterprise scenes.
 *
 * Which scenes a member has is the company's decision; which one sits first is
 * theirs, so it is a per-viewer preference kept in this browser and keyed by
 * server, project group and member — two people sharing a machine, or one
 * person in two project groups, never see each other's order. It can come back
 * empty (private window, cleared data), in which case scenes keep the server's
 * order.
 */

const KEY_PREFIX = 'one-enterprise:scene-order:';

export type SceneOrderScope = { server: string | null; tenantId: string; userId: string | null };

const storageKey = (scope: SceneOrderScope): string =>
  `${KEY_PREFIX}${scope.server ?? ''}|${scope.tenantId}|${scope.userId ?? ''}`;

export function loadSceneOrder(scope: SceneOrderScope): string[] {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveSceneOrder(scope: SceneOrderScope, order: string[]): void {
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(order));
  } catch {
    // An order that cannot be kept is a preference lost, not an error to show.
  }
}

/**
 * `scenes` in the member's order. Ids the order does not mention — scenes added
 * since — go after the ordered ones in the server's order; ids in the order
 * that no longer exist are ignored.
 */
export function applySceneOrder<T>(
  scenes: T[],
  order: string[],
  keyOf: (scene: T) => string = (scene) => (scene as { id: string }).id
): T[] {
  const byKey = new Map(scenes.map((scene) => [keyOf(scene), scene]));
  const ordered: T[] = [];
  for (const key of order) {
    const scene = byKey.get(key);
    if (scene) {
      ordered.push(scene);
      byKey.delete(key);
    }
  }
  return [...ordered, ...scenes.filter((scene) => byKey.has(keyOf(scene)))];
}

/** The order after dragging `activeId` onto `overId`'s place. Unknown ids change nothing. */
export function moveScene(ids: string[], activeId: string, overId: string): string[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
