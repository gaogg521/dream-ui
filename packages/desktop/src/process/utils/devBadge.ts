/**
 * Copyright 2026 One Work
 */

import type { NativeImage } from 'electron';
import { electronApp as app, electronNativeImage as nativeImage } from '@/common/electronSafe';

/**
 * A source checkout run with `bun run dev` and the installed app look identical
 * in the tray and on the taskbar, and both are often running at once. Marking
 * every OS-level surface of the dev build with a red dot is what tells them apart.
 */
export const isDevBuild = (): boolean => !app.isPackaged;

/** Marks the menu and tooltip text of the dev build; never shown by the installed app. */
export const DEV_TAG = '[DEV]';

const DOT = { r: 235, g: 51, b: 36 };

/** Paints a red dot with a white ring onto a copy of `size` x `size` BGRA pixels. */
const paintDot = (bitmap: Buffer, size: number, radiusRatio: number): void => {
  const radius = Math.max(3, Math.round(size * radiusRatio));
  const cx = size - radius - 1;
  const cy = size - radius - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (distance > radius + 1) continue;
      const offset = (y * size + x) * 4;
      const ring = distance > radius - 1;
      bitmap[offset] = ring ? 255 : DOT.b;
      bitmap[offset + 1] = ring ? 255 : DOT.g;
      bitmap[offset + 2] = ring ? 255 : DOT.r;
      bitmap[offset + 3] = 255;
    }
  }
};

/** The icon with a red dot in its corner (a copy; the original is untouched). */
export const withDevDot = (icon: NativeImage): NativeImage => {
  const { width, height } = icon.getSize();
  if (width === 0 || width !== height) return icon;
  const bitmap = Buffer.from(icon.toBitmap());
  paintDot(bitmap, width, 0.27);
  return nativeImage.createFromBitmap(bitmap, { width, height });
};

/** A plain red dot for the Windows taskbar overlay. */
export const createDevOverlayIcon = (): NativeImage => {
  const size = 16;
  const bitmap = Buffer.alloc(size * size * 4);
  paintDot(bitmap, size, 0.45);
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size });
};
