/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  isPackaged: false,
  created: [] as Array<{ buffer: Buffer; width: number; height: number }>,
}));

vi.mock('@/common/electronSafe', () => ({
  electronApp: {
    get isPackaged() {
      return electron.isPackaged;
    },
  },
  electronNativeImage: {
    createFromPath: vi.fn(),
    createFromBitmap: (buffer: Buffer, options: { width: number; height: number }) => {
      electron.created.push({ buffer, ...options });
      return { kind: 'created', ...options };
    },
  },
}));

import { createDevOverlayIcon, isDevBuild, withDevDot } from '@process/utils/devBadge';

const pixel = (buffer: Buffer, size: number, x: number, y: number) => {
  const offset = (y * size + x) * 4;
  return { b: buffer[offset], g: buffer[offset + 1], r: buffer[offset + 2], a: buffer[offset + 3] };
};

describe('dev build badge', () => {
  beforeEach(() => {
    electron.created.length = 0;
    electron.isPackaged = false;
  });

  it('is a dev build only when the app is not packaged', () => {
    expect(isDevBuild()).toBe(true);
    electron.isPackaged = true;
    expect(isDevBuild()).toBe(false);
  });

  it('paints a red dot in the corner of a copy of the icon and leaves the rest alone', () => {
    const size = 32;
    const source = Buffer.alloc(size * size * 4, 0x80);
    const original = Buffer.from(source);
    const icon = { getSize: () => ({ width: size, height: size }), toBitmap: () => source };

    withDevDot(icon as never);

    const painted = electron.created[0].buffer;
    expect(painted.length).toBe(source.length);
    // The dot centre is red and opaque; the opposite corner is the untouched source pixel.
    const centre = pixel(painted, size, size - 10, size - 10);
    expect(centre).toMatchObject({ r: 235, a: 255 });
    expect(pixel(painted, size, 0, 0)).toEqual(pixel(original, size, 0, 0));
    // The source bitmap itself is not modified.
    expect(source.equals(original)).toBe(true);
  });

  it('returns a non-square icon unchanged rather than guessing where its corner is', () => {
    const icon = { getSize: () => ({ width: 32, height: 16 }), toBitmap: () => Buffer.alloc(32 * 16 * 4) };
    expect(withDevDot(icon as never)).toBe(icon);
    expect(electron.created).toHaveLength(0);
  });

  it('builds a 16px taskbar overlay with a red dot', () => {
    const icon = createDevOverlayIcon() as unknown as { width: number; height: number };
    expect(icon).toMatchObject({ width: 16, height: 16 });
    const { buffer } = electron.created[0];
    expect(pixel(buffer, 16, 8, 8)).toMatchObject({ r: 235, g: 51, b: 36, a: 255 });
    // Outside the dot stays transparent so the taskbar icon shows through.
    expect(pixel(buffer, 16, 0, 0).a).toBe(0);
  });
});
