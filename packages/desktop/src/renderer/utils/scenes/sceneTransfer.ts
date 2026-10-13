/**
 * Copyright 2026 One Work
 */

/**
 * Moving personal scenes between machines and people.
 *
 * Personal scenes live on the machine they were made on. A file is how they
 * travel: export writes the person's scenes, import reads such a file and adds
 * its scenes as new ones (fresh ids, so importing never overwrites or duplicates
 * an existing scene's identity). The same file is how one person hands a scene
 * to another.
 */

import type { PersonalScene } from '@/common/types/platform/sceneTypes';
import { newPersonalScene, normalizePersonalScene } from './personalScenes';

const FORMAT = 'one-work-scenes';
const VERSION = 1;

/** The most scenes one file may add; a guard against a wrong file, not a product limit. */
export const MAX_IMPORTED_SCENES = 100;

export type ScenesFile = { format: typeof FORMAT; version: number; scenes: PersonalScene[] };

export function serializeScenes(scenes: PersonalScene[]): string {
  const file: ScenesFile = { format: FORMAT, version: VERSION, scenes };
  return JSON.stringify(file, null, 2);
}

export type ParsedScenes = { scenes: PersonalScene[]; skipped: number };

/** The scenes in an exported file, ready to add, or `null` when the text is not such a file. */
export function parseScenesFile(text: string): ParsedScenes | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const file = data as Partial<ScenesFile> | null;
  if (!file || file.format !== FORMAT || !Array.isArray(file.scenes)) return null;

  const scenes: PersonalScene[] = [];
  let skipped = 0;
  for (const raw of file.scenes.slice(0, MAX_IMPORTED_SCENES)) {
    const scene = normalizePersonalScene(raw);
    if (!scene) {
      skipped += 1;
      continue;
    }
    // Same content, a new identity of its own.
    scenes.push(
      newPersonalScene({
        name: scene.name,
        description: scene.description,
        icon: scene.icon,
        prompt: scene.prompt,
        intent: scene.intent,
        skillNames: scene.skillNames,
        mcpServerIds: scene.mcpServerIds,
        templateId: scene.templateId,
      })
    );
  }
  skipped += Math.max(0, file.scenes.length - MAX_IMPORTED_SCENES);
  return { scenes, skipped };
}
