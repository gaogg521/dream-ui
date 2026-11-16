/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: { get: async () => undefined, set: async () => undefined },
}));

import { MAX_AVATAR_DATA_URL_LENGTH, sanitizeAvatarDataUrl } from '@/renderer/utils/scenes/avatarImage';
import { newPersonalScene, normalizePersonalScene } from '@/renderer/utils/scenes/personalScenes';
import { personalSceneItem } from '@/renderer/utils/scenes/sceneItem';
import { parseScenesFile, serializeScenes } from '@/renderer/utils/scenes/sceneTransfer';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('sanitizeAvatarDataUrl', () => {
  it('keeps a small png/jpeg/webp data URL', () => {
    expect(sanitizeAvatarDataUrl(JPEG)).toBe(JPEG);
    expect(sanitizeAvatarDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBeDefined();
    expect(sanitizeAvatarDataUrl('data:image/webp;base64,UklGRg==')).toBeDefined();
  });

  it.each([
    ['a remote URL', 'https://example.com/a.png'],
    ['a script URL', 'javascript:alert(1)'],
    ['an svg data URL (can carry script)', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['a data URL that is not an image', 'data:text/html;base64,PGgxPg=='],
    ['markup smuggled in after the base64', `${JPEG}"><script>`],
    ['a non-string', 42],
    ['an empty string', ''],
  ])('drops %s', (_name, value) => {
    expect(sanitizeAvatarDataUrl(value)).toBeUndefined();
  });

  it('drops a picture larger than the cap', () => {
    expect(sanitizeAvatarDataUrl(`data:image/png;base64,${'A'.repeat(MAX_AVATAR_DATA_URL_LENGTH)}`)).toBeUndefined();
  });
});

describe('a scene with an uploaded picture', () => {
  it('survives being written and read back', () => {
    const scene = newPersonalScene({ name: 'Mine', avatarUrl: JPEG });
    const readBack = normalizePersonalScene(JSON.parse(JSON.stringify(scene)));
    expect(readBack?.avatarUrl).toBe(JPEG);
  });

  it('reads an older scene without a picture exactly as before', () => {
    const readBack = normalizePersonalScene({ id: 'a', name: 'Old', icon: '🌐' });
    expect(readBack).not.toBeNull();
    expect('avatarUrl' in (readBack ?? {})).toBe(false);
  });

  it('drops a stored picture that is not a data URL instead of rendering an arbitrary source', () => {
    const readBack = normalizePersonalScene({ id: 'a', name: 'Odd', avatarUrl: 'https://tracker.example/p.png' });
    expect(readBack?.avatarUrl).toBeUndefined();
  });

  it('is shown instead of the built-in portrait', () => {
    const withUpload = personalSceneItem(newPersonalScene({ name: 'Mine', icon: '🌐', avatarUrl: JPEG }));
    expect(withUpload.imageSrc).toBe(JPEG);
    const builtin = personalSceneItem(newPersonalScene({ name: 'Mine', icon: '🌐' }));
    expect(builtin.imageSrc).toMatch(/web\.png$/);
  });

  it('travels with an exported scene file and keeps a new identity on import', () => {
    const scene = newPersonalScene({ name: 'Shared', avatarUrl: JPEG });
    const parsed = parseScenesFile(serializeScenes([scene]));
    expect(parsed?.scenes).toHaveLength(1);
    expect(parsed?.scenes[0].avatarUrl).toBe(JPEG);
    expect(parsed?.scenes[0].id).not.toBe(scene.id);
  });
});
