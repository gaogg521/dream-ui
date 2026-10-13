/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common/config/storage', () => ({ ConfigStorage: { get: vi.fn(), set: vi.fn() } }));

import { MAX_IMPORTED_SCENES, parseScenesFile, serializeScenes } from '@/renderer/utils/scenes/sceneTransfer';
import { newPersonalScene } from '@/renderer/utils/scenes/personalScenes';

describe('exporting and importing personal scenes', () => {
  it('round-trips a scene with everything it carries', () => {
    const scene = newPersonalScene({
      name: '官网',
      description: 'd',
      icon: '🌐',
      prompt: 'p',
      skillNames: ['a'],
      mcpServerIds: ['m'],
      intent: { discovery: true, starters: ['s'], questions: ['q'], constraints: 'c', deliverables: 'x' },
    });
    const parsed = parseScenesFile(serializeScenes([scene]));
    expect(parsed?.scenes).toHaveLength(1);
    expect(parsed?.scenes[0]).toMatchObject({
      name: '官网',
      description: 'd',
      icon: '🌐',
      prompt: 'p',
      skillNames: ['a'],
      mcpServerIds: ['m'],
      intent: { discovery: true, starters: ['s'], questions: ['q'], constraints: 'c', deliverables: 'x' },
    });
  });

  it('gives imported scenes identities of their own, so importing never overwrites a scene', () => {
    const scene = newPersonalScene({ name: '官网' });
    const parsed = parseScenesFile(serializeScenes([scene]));
    expect(parsed?.scenes[0].id).not.toBe(scene.id);
  });

  it('refuses text that is not a scenes file', () => {
    expect(parseScenesFile('not json')).toBeNull();
    expect(parseScenesFile('{"scenes":[]}')).toBeNull();
    expect(parseScenesFile('{"format":"something-else","scenes":[]}')).toBeNull();
    expect(parseScenesFile('{"format":"one-work-scenes","scenes":"no"}')).toBeNull();
    expect(parseScenesFile('[]')).toBeNull();
  });

  it('skips entries that are not usable scenes and says how many', () => {
    const good = newPersonalScene({ name: '官网' });
    const parsed = parseScenesFile(
      JSON.stringify({ format: 'one-work-scenes', version: 1, scenes: [good, { nope: true }, 'junk', { id: 'x' }] })
    );
    expect(parsed?.scenes).toHaveLength(1);
    expect(parsed?.skipped).toBe(3);
  });

  it('reads a file with no scenes as an empty import', () => {
    expect(parseScenesFile(serializeScenes([]))).toEqual({ scenes: [], skipped: 0 });
  });

  it('caps what one file may add, as a guard against the wrong file', () => {
    const many = Array.from({ length: MAX_IMPORTED_SCENES + 5 }, (_, i) => newPersonalScene({ name: `s${i}` }));
    const parsed = parseScenesFile(serializeScenes(many));
    expect(parsed?.scenes).toHaveLength(MAX_IMPORTED_SCENES);
    expect(parsed?.skipped).toBe(5);
  });
});
