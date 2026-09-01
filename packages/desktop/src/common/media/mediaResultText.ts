/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse generated-media paths back out of a tool result.
 *
 * `executeMediaGeneration` appends one `Generated <kind> saved to: <path>` line
 * per asset — that line is a deliberate agent-facing contract (existing prompts
 * and habits depend on it), which makes it a stable thing for the renderer to
 * key off as well. Rendering keys off this instead of a structured message
 * field because media deliberately never became part of the dreamcore message
 * schema (design doc §8 Q4); the text carries the paths, the renderer layers a
 * richer view on top.
 *
 * Renderer-safe: no Node.js imports (path handling is string-only).
 */

import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@/common/config/constants';

export type ParsedMediaAsset = {
  kind: 'image' | 'video';
  /** Absolute path exactly as the tool reported it. */
  filePath: string;
  fileName: string;
};

/**
 * Matches the contract line. The kind word is captured rather than inferred so
 * a future media kind still parses; the extension check below is what decides
 * how to render.
 */
const SAVED_LINE_RE = /^[ \t]*Generated\s+(image|video)\s+saved to:\s*(.+?)[ \t]*$/gim;

const extensionOf = (filePath: string): string => {
  const name = filePath.split(/[/\\]/).pop() || '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

export const fileNameOf = (filePath: string): string => filePath.split(/[/\\]/).pop() || filePath;

export const isImagePath = (filePath: string): boolean =>
  (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));

export const isVideoPath = (filePath: string): boolean =>
  (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(filePath));

/**
 * Extract every generated asset mentioned in a tool result.
 *
 * Duplicates are collapsed: a result that both lists a path and mentions it in
 * prose should still render one tile.
 */
export const parseGeneratedMediaAssets = (text: string): ParsedMediaAsset[] => {
  if (!text) return [];

  const seen = new Set<string>();
  const assets: ParsedMediaAsset[] = [];

  for (const match of text.matchAll(SAVED_LINE_RE)) {
    const filePath = match[2].trim();
    if (!filePath || seen.has(filePath)) continue;

    // Trust the extension over the announced kind: the extension is what the
    // player/gallery actually needs to be right about.
    const kind = isVideoPath(filePath) ? 'video' : isImagePath(filePath) ? 'image' : null;
    if (!kind) continue;

    seen.add(filePath);
    assets.push({ kind, filePath, fileName: fileNameOf(filePath) });
  }

  return assets;
};
