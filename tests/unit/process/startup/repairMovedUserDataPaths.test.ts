/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { USERDATA_MOVED_FROM_MARKER } from '@/common/platform';

/**
 * The shipped driver is better-sqlite3, a native module built against
 * Electron's ABI — loading it under the vitest node runtime fails outright
 * (NODE_MODULE_VERSION mismatch). Node's own `node:sqlite` is a real SQLite,
 * so the repair still runs against real SQL and a real file rather than a
 * hand-written fake that would agree with whatever the code does.
 */
vi.mock('@process/services/database/drivers/BetterSqlite3Driver', () => ({
  BetterSqlite3Driver: class {
    private db: DatabaseSync;
    constructor(dbPath: string) {
      this.db = new DatabaseSync(dbPath);
    }
    prepare(sql: string) {
      return this.db.prepare(sql);
    }
    exec(sql: string) {
      this.db.exec(sql);
    }
    pragma(sql: string) {
      this.db.exec(`PRAGMA ${sql}`);
    }
    transaction<T>(fn: (...args: unknown[]) => T) {
      return (...args: unknown[]): T => {
        this.db.exec('BEGIN');
        try {
          const out = fn(...args);
          this.db.exec('COMMIT');
          return out;
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      };
    }
    close() {
      this.db.close();
    }
  },
}));

import {
  readMovedFromMarker,
  repairMovedUserDataPaths,
  rerootJson,
  rerootPath,
} from '@/process/startup/repairMovedUserDataPaths';

const OLD = 'C:\\Users\\a\\AppData\\Roaming\\1ONE Code';
const NEW = 'C:\\Users\\a\\AppData\\Roaming\\One Work';

describe('rerootPath', () => {
  it('re-roots the directory itself and anything under it', () => {
    expect(rerootPath(OLD, OLD, NEW)).toBe(NEW);
    expect(rerootPath(`${OLD}\\1one\\conversations\\c1`, OLD, NEW)).toBe(`${NEW}\\1one\\conversations\\c1`);
  });

  it('handles posix separators', () => {
    expect(
      rerootPath('/home/a/.config/1ONE Code/1one/x', '/home/a/.config/1ONE Code', '/home/a/.config/One Work')
    ).toBe('/home/a/.config/One Work/1one/x');
  });

  /**
   * The displaced profile from an import swap sits at
   * "One Work.superseded-<ts>", right next to the directory being matched. A
   * plain startsWith would rewrite paths into it.
   */
  it('only matches on a path boundary, never a name prefix', () => {
    expect(rerootPath(`${OLD}.superseded-123\\1one`, OLD, NEW)).toBeNull();
    expect(rerootPath(`${OLD}x\\1one`, OLD, NEW)).toBeNull();
  });

  it('leaves unrelated paths alone', () => {
    expect(rerootPath('D:\\projects\\thing', OLD, NEW)).toBeNull();
    expect(rerootPath('', OLD, NEW)).toBeNull();
  });
});

describe('rerootJson', () => {
  it('rewrites nested strings and reports no-change as null', () => {
    const input = { workspace: `${OLD}\\1one\\w`, skills: ['a'], nested: { files: [`${OLD}\\f.png`, 'D:\\keep'] } };

    expect(rerootJson(input, OLD, NEW)).toEqual({
      workspace: `${NEW}\\1one\\w`,
      skills: ['a'],
      nested: { files: [`${NEW}\\f.png`, 'D:\\keep'] },
    });
    expect(rerootJson({ workspace: 'D:\\elsewhere' }, OLD, NEW)).toBeNull();
  });
});

/**
 * The end-to-end block below runs against a real temp directory and a real
 * SQLite file, so its fixtures use NATIVE separators (`path.join`) rather than
 * the Windows literals above.
 *
 * The separator style is not incidental. `rerootPath` deliberately preserves
 * whatever separator the stored value used — a path captured on Windows must
 * stay a Windows path — so a fixture that writes backslash paths while the
 * assertion computes `path.join(...)` agrees with itself only on Windows. That
 * is exactly how this file passed on the author's machine and then failed the
 * first time CI ran it on Linux. Both separator styles are still covered,
 * explicitly and platform-independently, by the `rerootPath` / `rerootJson`
 * blocks above; this block's job is the SQL and the file I/O.
 */
describe('repairMovedUserDataPaths', () => {
  let root: string;
  let userDataDir: string;
  let oldUserDataDir: string;
  let configDir: string;
  let dbPath: string;

  const openDb = () => new DatabaseSync(dbPath);
  /** A path under the OLD profile, in this platform's own separator style. */
  const inOldProfile = (...segments: string[]) => path.join(oldUserDataDir, ...segments);
  /** The same path after the move — what the repair is expected to produce. */
  const inNewProfile = (...segments: string[]) => path.join(userDataDir, ...segments);

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onework-repair-'));
    userDataDir = path.join(root, 'One Work');
    oldUserDataDir = path.join(root, '1ONE Code');
    configDir = path.join(userDataDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    dbPath = path.join(userDataDir, 'one-backend.db');

    const db = openDb();
    db.exec(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY, extra TEXT);
      CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT);
      CREATE TABLE skills (id TEXT PRIMARY KEY, path TEXT);
      CREATE TABLE one_media_assets (id TEXT PRIMARY KEY, file_path TEXT);
    `);
    db.prepare('INSERT INTO conversations VALUES (?, ?)').run(
      'c1',
      JSON.stringify({ workspace: inOldProfile('1one', 'conversations', 'c1'), skills: ['cron'] })
    );
    db.prepare('INSERT INTO conversations VALUES (?, ?)').run('c2', JSON.stringify({ workspace: 'D:\\my-project' }));
    db.prepare('INSERT INTO conversations VALUES (?, ?)').run('c3', 'not json at all');
    db.prepare('INSERT INTO messages VALUES (?, ?)').run('m1', `I read ${inOldProfile('1one', 'notes.md')} for you`);
    db.prepare('INSERT INTO skills VALUES (?, ?)').run('s1', inOldProfile('1one', 'builtin-skills', 'moltbook'));
    db.prepare('INSERT INTO one_media_assets VALUES (?, ?)').run('a1', inOldProfile('1one', 'vid.mp4'));
    db.close();

    fs.writeFileSync(path.join(userDataDir, USERDATA_MOVED_FROM_MARKER), oldUserDataDir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('re-roots live pointers and leaves the transcript untouched', async () => {
    const report = await repairMovedUserDataPaths({ userDataDir, configDir, dbPath });

    expect(report).toMatchObject({ from: oldUserDataDir, conversations: 1, skills: 1, mediaAssets: 1 });

    const db = openDb();
    const conv = db.prepare('SELECT extra FROM conversations WHERE id = ?').get('c1') as { extra: string };
    expect(JSON.parse(conv.extra).workspace).toBe(inNewProfile('1one', 'conversations', 'c1'));

    const untouched = db.prepare('SELECT extra FROM conversations WHERE id = ?').get('c2') as { extra: string };
    expect(JSON.parse(untouched.extra).workspace).toBe('D:\\my-project');

    expect((db.prepare('SELECT path FROM skills WHERE id = ?').get('s1') as { path: string }).path).toContain(
      userDataDir
    );
    expect(
      (db.prepare('SELECT file_path FROM one_media_assets WHERE id = ?').get('a1') as { file_path: string }).file_path
    ).toContain(userDataDir);

    /**
     * The transcript is a record of what happened, not a pointer anything
     * resolves. Rewriting it would falsify history — and mangle sentences that
     * merely mention the old directory by name.
     */
    expect((db.prepare('SELECT content FROM messages WHERE id = ?').get('m1') as { content: string }).content).toBe(
      `I read ${inOldProfile('1one', 'notes.md')} for you`
    );
    db.close();
  });

  it('repairs the media-job store', async () => {
    const jobs = path.join(configDir, 'media-jobs.json');
    fs.writeFileSync(
      jobs,
      JSON.stringify({
        version: 1,
        jobs: [
          {
            id: 'j1',
            workspaceDir: inOldProfile('1one', 'w'),
            origin: { workspaceDir: inOldProfile('1one', 'w') },
          },
        ],
      })
    );

    const report = await repairMovedUserDataPaths({ userDataDir, configDir, dbPath });

    expect(report?.mediaJobs).toBe(1);
    const written = JSON.parse(fs.readFileSync(jobs, 'utf8'));
    expect(written.jobs[0].workspaceDir).toBe(inNewProfile('1one', 'w'));
    expect(written.jobs[0].origin.workspaceDir).toBe(inNewProfile('1one', 'w'));
  });

  it('clears the marker so the repair runs exactly once', async () => {
    await repairMovedUserDataPaths({ userDataDir, configDir, dbPath });

    expect(readMovedFromMarker(userDataDir)).toBeNull();
    expect(await repairMovedUserDataPaths({ userDataDir, configDir, dbPath })).toBeNull();
  });

  it('does nothing at all on a profile that was never moved', async () => {
    fs.rmSync(path.join(userDataDir, USERDATA_MOVED_FROM_MARKER));

    expect(await repairMovedUserDataPaths({ userDataDir, configDir, dbPath })).toBeNull();

    const db = openDb();
    const conv = db.prepare('SELECT extra FROM conversations WHERE id = ?').get('c1') as { extra: string };
    expect(JSON.parse(conv.extra).workspace).toBe(inOldProfile('1one', 'conversations', 'c1'));
    db.close();
  });

  /**
   * A marker naming the directory it sits in would re-root every path onto
   * itself — harmless but pointless work on every launch.
   */
  it('ignores a marker that points at the current directory', () => {
    fs.writeFileSync(path.join(userDataDir, USERDATA_MOVED_FROM_MARKER), userDataDir);

    expect(readMovedFromMarker(userDataDir)).toBeNull();
  });
});
