/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: undefined as unknown, fail: false }));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: async () => {
      if (store.fail) throw new Error('storage unavailable');
      return store.data;
    },
    set: async (_key: string, value: unknown) => {
      store.data = value;
      return value;
    },
  },
}));

import {
  loadPersonalScenes,
  newPersonalScene,
  normalizeIntent,
  normalizePersonalScene,
  personalSceneKey,
  personalSceneProblems,
  removePersonalScene,
  savePersonalScenes,
  upsertPersonalScene,
} from '@/renderer/utils/scenes/personalScenes';
import { SCENE_LIMITS } from '@/common/types/platform/sceneTypes';

describe('normalizeIntent', () => {
  it('asks questions first unless the scene says otherwise', () => {
    expect(normalizeIntent(undefined).discovery).toBe(true);
    expect(normalizeIntent({}).discovery).toBe(true);
    expect(normalizeIntent({ discovery: false }).discovery).toBe(false);
  });

  it('keeps usable lines, drops blank ones and enforces the limits', () => {
    const intent = normalizeIntent({
      starters: ['a', '  ', 'b', 'c', 'd', 'e'],
      questions: Array.from({ length: 12 }, (_, i) => `q${i}`),
      constraints: 'x'.repeat(SCENE_LIMITS.constraints + 50),
    });
    expect(intent.starters).toEqual(['a', 'b', 'c', 'd']);
    expect(intent.questions).toHaveLength(SCENE_LIMITS.questions);
    expect(intent.constraints).toHaveLength(SCENE_LIMITS.constraints);
  });

  it('reads garbage as empty rather than failing', () => {
    const intent = normalizeIntent({ starters: 'nope', questions: [1, null, 'ok'], constraints: 7 });
    expect(intent.starters).toEqual([]);
    expect(intent.questions).toEqual(['ok']);
    expect(intent.constraints).toBe('');
  });
});

describe('normalizePersonalScene', () => {
  it('drops what is not a usable scene', () => {
    expect(normalizePersonalScene(null)).toBeNull();
    expect(normalizePersonalScene('x')).toBeNull();
    expect(normalizePersonalScene({ id: 'a' })).toBeNull();
    expect(normalizePersonalScene({ name: 'a' })).toBeNull();
  });

  it('fills what a stored scene lacks and trims what it has', () => {
    const scene = normalizePersonalScene({
      id: 'a',
      name: '  官网  ',
      skillNames: ['x', 'x', 3, ''],
      mcpServerIds: 'no',
    });
    expect(scene).toMatchObject({
      id: 'a',
      name: '官网',
      skillNames: ['x'],
      mcpServerIds: [],
      description: '',
      prompt: '',
    });
    expect(scene?.icon).toBeTruthy();
    expect(scene?.intent.discovery).toBe(true);
  });
});

describe('the list', () => {
  it('adds a new scene, replaces one with the same id, and removes by id', () => {
    const a = newPersonalScene({ name: 'a' });
    const b = newPersonalScene({ name: 'b' });
    let list = upsertPersonalScene([], a);
    list = upsertPersonalScene(list, b);
    expect(list.map((s) => s.name)).toEqual(['a', 'b']);
    list = upsertPersonalScene(list, { ...a, name: 'a2' });
    expect(list.map((s) => s.name)).toEqual(['a2', 'b']);
    expect(removePersonalScene(list, a.id).map((s) => s.name)).toEqual(['b']);
  });

  it('gives every new scene its own id, in an id space apart from the company ones', () => {
    const a = newPersonalScene();
    const b = newPersonalScene();
    expect(a.id).not.toBe(b.id);
    expect(personalSceneKey(a.id)).toBe(`mine:${a.id}`);
  });

  it('wants a name and nothing else', () => {
    expect(personalSceneProblems(newPersonalScene())).toEqual(['nameRequired']);
    expect(personalSceneProblems(newPersonalScene({ name: '   ' }))).toEqual(['nameRequired']);
    expect(personalSceneProblems(newPersonalScene({ name: '官网' }))).toEqual([]);
  });
});

describe('storage', () => {
  beforeEach(() => {
    store.data = undefined;
    store.fail = false;
  });

  it('round-trips through the settings store', async () => {
    const a = newPersonalScene({ name: '官网', prompt: 'p' });
    await savePersonalScenes([a]);
    const read = await loadPersonalScenes();
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ id: a.id, name: '官网', prompt: 'p' });
  });

  it('reads nothing stored as an empty list, and bad entries are dropped without losing the rest', async () => {
    expect(await loadPersonalScenes()).toEqual([]);
    store.data = [{ id: 'ok', name: 'fine' }, { nope: true }, 'junk'];
    expect((await loadPersonalScenes()).map((s) => s.id)).toEqual(['ok']);
    store.data = { not: 'a list' };
    expect(await loadPersonalScenes()).toEqual([]);
  });

  it('reads an unavailable store as an empty list rather than failing the page', async () => {
    store.fail = true;
    expect(await loadPersonalScenes()).toEqual([]);
  });
});
