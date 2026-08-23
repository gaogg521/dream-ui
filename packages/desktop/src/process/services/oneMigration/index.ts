/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ensureDirectory, getDataPath } from '@process/utils';
import type { OneLegacyConfigFile } from './importOneLegacyConfig';
import { importOneLegacyConfig } from './importOneLegacyConfig';
import { importOneLegacyDb } from './importOneLegacyDb';

const MARKER_FILE = 'one-import.json';

type OneImportMarker = {
  version: 1;
  importedAt: string;
  sourceRoot: string;
  db: {
    targetDb: string;
    backupPath: string | null;
    counts: Record<string, number>;
    skippedTables: string[];
  } | null;
  configKeys: string[];
};

/**
 * Locate a 1ONE ClaudeCode install's userData root. `DREAM_ONE_IMPORT_DIR`
 * overrides detection (used for tests and for importing from a dev profile).
 */
export function resolveOneSourceRoot(): string | null {
  const override = process.env.DREAM_ONE_IMPORT_DIR;
  if (override) {
    return existsSync(override) ? override : null;
  }

  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, '1ONE ClaudeCode'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', '1ONE ClaudeCode'));
  } else {
    candidates.push(path.join(home, '.config', '1ONE ClaudeCode'));
  }

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, '1one', '1one.db'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * One-shot import of 1ONE ClaudeCode (1one) data + config into this install.
 *
 * Runs during initStorage, after the legacy DB handoff upgrade and before the
 * backend spawns. Idempotence is anchored on a marker file in the data dir:
 * the import runs at most once per install, and only writes the marker after
 * a fully successful pass (a failed pass retries on the next launch, where
 * INSERT OR IGNORE makes the replay safe). The 1one install itself is never
 * written to.
 *
 * Returns a short human-readable summary for the startup trace.
 */
export async function runOneLegacyImport(configFile: OneLegacyConfigFile): Promise<string> {
  const dataDir = getDataPath();
  const markerPath = path.join(dataDir, MARKER_FILE);
  if (existsSync(markerPath)) {
    return 'already-imported';
  }

  const sourceRoot = resolveOneSourceRoot();
  if (!sourceRoot) {
    return 'no-source';
  }

  const sourceDb = path.join(sourceRoot, '1one', '1one.db');
  const sourceConfig = path.join(sourceRoot, 'config', 'one-config.txt');

  ensureDirectory(dataDir);

  const dbResult = await importOneLegacyDb(sourceDb, dataDir);
  const configResult = existsSync(sourceConfig)
    ? await importOneLegacyConfig(configFile, sourceConfig)
    : { importedKeys: [] };

  const marker: OneImportMarker = {
    version: 1,
    importedAt: new Date().toISOString(),
    sourceRoot,
    db: dbResult,
    configKeys: configResult.importedKeys,
  };
  await writeFile(markerPath, JSON.stringify(marker, null, 2), 'utf8');

  const countSummary = Object.entries(dbResult.counts)
    .map(([table, count]) => `${table}=${count}`)
    .join(',');
  return `imported ${countSummary} configKeys=${configResult.importedKeys.length} target=${path.basename(dbResult.targetDb)}`;
}
