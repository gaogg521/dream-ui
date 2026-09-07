/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Re-root the absolute paths that a userData directory move left behind.
 *
 * Renaming the profile directory is only half the migration. Several stores
 * persist ABSOLUTE paths captured under the old name, and after the rename
 * every one of them points at a directory that no longer exists:
 *
 * - `conversations.extra.workspace` — the per-conversation workspace. This is
 *   the one users actually hit: opening an old conversation reports "Agent
 *   failed to run in this workspace path — make sure <old path> exists".
 * - `skills.path` — a skill materialised under the profile.
 * - `one_media_assets.file_path` — generated images and video, so previews in
 *   old conversations stop resolving.
 * - `media-jobs.json` `workspaceDir` — where a media job wrote its output.
 *
 * Deliberately NOT rewritten: `messages.content`. Those rows are the
 * transcript — tool-call arguments, the model's reasoning, prose that discusses
 * the old directory by name. They are a record of what happened, not pointers
 * anything resolves, and editing them would falsify history and mangle
 * sentences that merely mention the old brand name.
 *
 * Runs after `initializeProcess()` and BEFORE the backend starts: it opens the
 * catalog directly, which is only safe while no dreamcore holds it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { USERDATA_MOVED_FROM_MARKER } from '@/common/platform';

export type MovedPathRepairReport = {
  from: string;
  conversations: number;
  skills: number;
  mediaAssets: number;
  mediaJobs: number;
};

/** Live-pointer columns, per table. `messages.content` is excluded by design. */
const PATH_COLUMNS: ReadonlyArray<{ table: string; idColumn: string; column: string }> = [
  { table: 'skills', idColumn: 'id', column: 'path' },
  { table: 'one_media_assets', idColumn: 'id', column: 'file_path' },
];

/**
 * Re-root `value` when it sits under `from`, else null.
 *
 * Matches on a path boundary, so a sibling whose name merely starts with the
 * old one — "One Work" next to "One Work.superseded-…" — is never rewritten.
 */
export function rerootPath(value: string, from: string, to: string): string | null {
  if (value === from) return to;
  for (const sep of ['\\', '/']) {
    const prefix = from.endsWith(sep) ? from : from + sep;
    if (value.startsWith(prefix)) return to + sep + value.slice(prefix.length);
  }
  return null;
}

/** Re-root every string inside a JSON value. Returns null when nothing changed. */
export function rerootJson<T>(value: T, from: string, to: string): T | null {
  let changed = false;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const next = rerootPath(node, from, to);
      if (next === null) return node;
      changed = true;
      return next;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) out[key] = walk(child);
      return out;
    }
    return node;
  };
  const result = walk(value) as T;
  return changed ? result : null;
}

type MinimalDb = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
};

function tableExists(db: MinimalDb, table: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

/**
 * The old root recorded by `migrateAndResolveProdUserDataDir`, or null when
 * this profile was never moved — the overwhelmingly common case, and one
 * failed read of a file that is not there.
 */
export function readMovedFromMarker(userDataDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, USERDATA_MOVED_FROM_MARKER), 'utf8').trim();
    return raw && path.resolve(raw) !== path.resolve(userDataDir) ? raw : null;
  } catch {
    return null;
  }
}

function repairMediaJobs(configDir: string, from: string, to: string): number {
  const file = path.join(configDir, 'media-jobs.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return 0;
  }
  const next = rerootJson(parsed, from, to);
  if (next === null) return 0;
  // Written through a temp file: a half-written store loses every job, and this
  // is a code path the user has already been let down by once.
  const tmp = `${file}.repair.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return 1;
}

/**
 * Rewrite the stores, then drop the marker.
 *
 * `dbPath` must be resolved the way the backend resolves it (current name,
 * falling back to the pre-rebrand one): repairing a catalog dreamcore does not
 * read would fix nothing while reporting success.
 */
export async function repairMovedUserDataPaths(opts: {
  userDataDir: string;
  configDir: string;
  dbPath: string;
}): Promise<MovedPathRepairReport | null> {
  const from = readMovedFromMarker(opts.userDataDir);
  if (!from) return null;
  const to = path.resolve(opts.userDataDir);

  const report: MovedPathRepairReport = { from, conversations: 0, skills: 0, mediaAssets: 0, mediaJobs: 0 };

  if (fs.existsSync(opts.dbPath)) {
    const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
    const db = new BetterSqlite3Driver(opts.dbPath);
    try {
      db.pragma('busy_timeout = 5000');
      const apply = db.transaction(() => {
        if (tableExists(db, 'conversations')) {
          const rows = db.prepare('SELECT id, extra FROM conversations WHERE extra IS NOT NULL').all() as Array<{
            id: string;
            extra: string;
          }>;
          const update = db.prepare('UPDATE conversations SET extra = ? WHERE id = ?');
          for (const row of rows) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(row.extra);
            } catch {
              continue;
            }
            const next = rerootJson(parsed, from, to);
            if (next === null) continue;
            update.run(JSON.stringify(next), row.id);
            report.conversations += 1;
          }
        }
        for (const { table, idColumn, column } of PATH_COLUMNS) {
          if (!tableExists(db, table)) continue;
          const rows = db
            .prepare(`SELECT "${idColumn}" AS id, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`)
            .all() as Array<{ id: string; value: string }>;
          const update = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${idColumn}" = ?`);
          for (const row of rows) {
            const next = rerootPath(row.value, from, to);
            if (next === null) continue;
            update.run(next, row.id);
            if (table === 'skills') report.skills += 1;
            else report.mediaAssets += 1;
          }
        }
      });
      apply();
    } finally {
      db.close();
    }
  }

  report.mediaJobs = repairMediaJobs(opts.configDir, from, to);

  // Only now. A marker removed before the rewrite landed would leave the
  // profile permanently half-migrated with nothing left to say so.
  try {
    fs.rmSync(path.join(opts.userDataDir, USERDATA_MOVED_FROM_MARKER), { force: true });
  } catch (error) {
    console.warn('[userdata-repair] could not remove the move marker; the repair will run again next launch', error);
  }

  console.log(
    `[userdata-repair] re-rooted paths from "${from}": ${report.conversations} conversations, ` +
      `${report.skills} skills, ${report.mediaAssets} media assets, ${report.mediaJobs} media-job stores`
  );
  return report;
}
