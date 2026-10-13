/** @vitest-environment jsdom */
/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDisabledScenes, saveDisabledScenes, setSceneEnabled } from '@/renderer/components/enterprise/sceneEnabled';
import type { SceneOrderScope } from '@/renderer/components/enterprise/sceneOrder';

const scope = (patch: Partial<SceneOrderScope> = {}): SceneOrderScope => ({
  server: 'https://one.corp',
  tenantId: 't1',
  userId: 'u1',
  ...patch,
});

describe('setSceneEnabled', () => {
  it('switching a scene off adds it once, and on removes it', () => {
    expect(setSceneEnabled([], 'a', false)).toEqual(['a']);
    expect(setSceneEnabled(['a'], 'a', false)).toEqual(['a']);
    expect(setSceneEnabled(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('switching on a scene that was never off changes nothing', () => {
    expect(setSceneEnabled(['b'], 'a', true)).toEqual(['b']);
  });
});

describe('the saved off set', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and starts empty, so a new scene is on', () => {
    expect(loadDisabledScenes(scope())).toEqual([]);
    saveDisabledScenes(scope(), ['a', 'c']);
    expect(loadDisabledScenes(scope())).toEqual(['a', 'c']);
  });

  it('is private to the member, project group and server', () => {
    saveDisabledScenes(scope(), ['a']);
    expect(loadDisabledScenes(scope({ userId: 'u2' }))).toEqual([]);
    expect(loadDisabledScenes(scope({ tenantId: 't2' }))).toEqual([]);
    expect(loadDisabledScenes(scope({ server: 'https://other.corp' }))).toEqual([]);
  });

  it('reads garbage as nothing switched off, and survives storage that refuses writes', () => {
    localStorage.setItem('one-enterprise:scene-off:https://one.corp|t1|u1', '{oops');
    expect(loadDisabledScenes(scope())).toEqual([]);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveDisabledScenes(scope(), ['a'])).not.toThrow();
    set.mockRestore();
  });
});
