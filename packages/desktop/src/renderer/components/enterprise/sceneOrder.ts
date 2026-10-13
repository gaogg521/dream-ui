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
export function applySceneOrder<T extends { id: string }>(scenes: T[], order: string[]): T[] {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const ordered: T[] = [];
  for (const id of order) {
    const scene = byId.get(id);
    if (scene) {
      ordered.push(scene);
      byId.delete(id);
    }
  }
  return [...ordered, ...scenes.filter((scene) => byId.has(scene.id))];
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
