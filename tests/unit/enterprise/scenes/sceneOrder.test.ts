/** @vitest-environment jsdom */
/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applySceneOrder,
  loadSceneOrder,
  moveScene,
  saveSceneOrder,
  type SceneOrderScope,
} from '@/renderer/components/enterprise/sceneOrder';

const scope = (patch: Partial<SceneOrderScope> = {}): SceneOrderScope => ({
  server: 'https://one.corp',
  tenantId: 't1',
  userId: 'u1',
  ...patch,
});
const ids = (list: { id: string }[]) => list.map((s) => s.id);
const scenes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const KEY = 'one-enterprise:scene-order:https://one.corp|t1|u1';

describe('applySceneOrder', () => {
  it('puts scenes in the member order', () => {
    expect(ids(applySceneOrder(scenes, ['c', 'a', 'd', 'b']))).toEqual(['c', 'a', 'd', 'b']);
  });

  it('keeps new scenes after the ordered ones, in the server order', () => {
    expect(ids(applySceneOrder(scenes, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('ignores scenes the member no longer has and never duplicates one', () => {
    expect(ids(applySceneOrder(scenes, ['gone', 'b', 'b', 'a']))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('is the server order when nothing was ever saved', () => {
    expect(ids(applySceneOrder(scenes, []))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('moveScene', () => {
  it('moves the dragged scene to the place of the one it was dropped on', () => {
    expect(moveScene(['a', 'b', 'c', 'd'], 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(moveScene(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('changes nothing for a drop on itself or on something unknown', () => {
    const order = ['a', 'b', 'c'];
    expect(moveScene(order, 'b', 'b')).toBe(order);
    expect(moveScene(order, 'b', 'zzz')).toBe(order);
    expect(moveScene(order, 'zzz', 'a')).toBe(order);
  });
});

describe('the saved order', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips', () => {
    saveSceneOrder(scope(), ['c', 'a']);
    expect(loadSceneOrder(scope())).toEqual(['c', 'a']);
  });

  it('is private to the member, project group and server', () => {
    saveSceneOrder(scope(), ['c', 'a']);
    expect(loadSceneOrder(scope({ userId: 'u2' }))).toEqual([]);
    expect(loadSceneOrder(scope({ tenantId: 't2' }))).toEqual([]);
    expect(loadSceneOrder(scope({ server: 'https://other.corp' }))).toEqual([]);
  });

  it('reads garbage as no preference rather than failing the page', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadSceneOrder(scope())).toEqual([]);
    localStorage.setItem(KEY, '{"a":1}');
    expect(loadSceneOrder(scope())).toEqual([]);
    localStorage.setItem(KEY, '["a",3,null,"b"]');
    expect(loadSceneOrder(scope())).toEqual(['a', 'b']);
  });

  it('survives storage that refuses writes', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveSceneOrder(scope(), ['a'])).not.toThrow();
    set.mockRestore();
  });
});
