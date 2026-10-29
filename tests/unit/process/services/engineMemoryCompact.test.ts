import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMPACT_THRESHOLD,
  MERGED_MARKER,
  compactGroup,
  compactionStatus,
  undoCompaction,
} from '@process/services/engineMemory/compact';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const GROUP = '_shared';

let base: string;
const memDir = () => path.join(base, 'projects', GROUP, 'memory');

/** Write a memory file and stamp it `ageDays` old. */
const put = (filename: string, name: string, type: string, body: string, ageDays: number) => {
  mkdirSync(memDir(), { recursive: true });
  const file = path.join(memDir(), filename);
  writeFileSync(file, `---\nname: ${name}\ndescription: about ${name}\ntype: ${type}\n---\n\n${body}\n`, 'utf-8');
  const when = new Date(NOW - ageDays * DAY);
  utimesSync(file, when, when);
};
const writeIndex = (lines: string[]) =>
  writeFileSync(path.join(memDir(), 'MEMORY.md'), `# Memory Index\n\n${lines.join('\n')}\n`, 'utf-8');
const read = (filename: string) => readFileSync(path.join(memDir(), filename), 'utf-8');
const files = () => readdirSync(memDir()).toSorted();

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'engine-compact-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Four old user memories in September, two old project ones in August, one lone old one, two recent. */
const seed = () => {
  put('u1.md', 'Codename', 'user', 'Code name: Beichen 7', 40);
  put('u2.md', 'Address form', 'user', 'Call the person Teacher Zhou', 39);
  put('u3.md', 'Language', 'user', 'Answer in Chinese', 38);
  put('u4.md', 'Tone', 'user', 'Keep answers terse', 37);
  put('p1.md', 'Project North Star', 'project', 'Led by Zhou Mingyuan', 70);
  put('p2.md', 'Release freeze', 'project', 'Freeze starts Thursday', 69);
  put('lone.md', 'Lone reference', 'reference', 'Only one in its month', 100);
  put('recent1.md', 'Fresh note', 'user', 'Saved yesterday', 1);
  put('recent2.md', 'Another fresh note', 'feedback', 'Saved today', 0);
  writeIndex([
    '- [Codename](u1.md) — code name',
    '- [Address form](u2.md) — how to address',
    '- [Language](u3.md) — language',
    '- [Tone](u4.md) — tone',
    '- [Project North Star](p1.md) — north star',
    '- [Release freeze](p2.md) — freeze',
    '- [Lone reference](lone.md) — lone',
    '- [Fresh note](recent1.md) — fresh',
    '- [Another fresh note](recent2.md) — fresh2',
  ]);
};

describe('compactionStatus', () => {
  it('only suggests tidying once the directory is long and has old memories to fold', () => {
    seed();
    expect(compactionStatus(base, GROUP, NOW)).toMatchObject({
      total: 9,
      mergeable: 6,
      suggested: false,
      backup: null,
    });

    for (let i = 0; i < COMPACT_THRESHOLD; i++) put(`bulk_${i}.md`, `Bulk ${i}`, 'reference', 'x', 5 + (i % 3));
    const status = compactionStatus(base, GROUP, NOW);
    expect(status.total).toBe(9 + COMPACT_THRESHOLD);
    // Everything added is recent, so it is long but there is still nothing new to fold.
    expect(status.mergeable).toBe(6);
    expect(status.suggested).toBe(true);
  });

  it('does not suggest when the directory is long but everything is recent', () => {
    for (let i = 0; i < COMPACT_THRESHOLD + 5; i++) put(`n_${i}.md`, `N ${i}`, 'user', 'x', 2);
    expect(compactionStatus(base, GROUP, NOW)).toMatchObject({ mergeable: 0, suggested: false });
  });
});

describe('compactGroup', () => {
  it('folds old memories of one type and month into one file and leaves recent ones alone', () => {
    seed();
    const result = compactGroup(base, GROUP, NOW);

    expect(result).toMatchObject({ merged: 6, mergedInto: 2, kept: 3 });
    expect(files()).toEqual(
      [
        'MEMORY.md',
        'lone.md',
        'merged_project_2026-08.md',
        'merged_user_2026-09.md',
        'recent1.md',
        'recent2.md',
      ].toSorted()
    );
    // The originals are gone; a lone old file has nothing to be merged with and stays.
    expect(existsSync(path.join(memDir(), 'u1.md'))).toBe(false);
  });

  it('keeps every original word for word as a section of the merged file', () => {
    seed();
    compactGroup(base, GROUP, NOW);
    const merged = read('merged_user_2026-09.md');
    expect(merged).toContain(MERGED_MARKER);
    for (const text of [
      'Code name: Beichen 7',
      'Call the person Teacher Zhou',
      'Answer in Chinese',
      'Keep answers terse',
    ]) {
      expect(merged).toContain(text);
    }
    expect(merged).toContain('## Codename');
    expect(merged).toContain('## Tone');
    // Oldest first.
    expect(merged.indexOf('## Codename')).toBeLessThan(merged.indexOf('## Tone'));
    expect(merged).toMatch(/^---\nname: user memories 2026-09\n/);
  });

  it('rewrites the index: merged files first, lines of files that stayed kept, moved lines gone', () => {
    seed();
    compactGroup(base, GROUP, NOW);
    const lines = read('MEMORY.md')
      .split('\n')
      .filter((l) => l.startsWith('- ['));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('merged_');
    expect(lines[1]).toContain('merged_');
    expect(lines.join('\n')).toContain('(lone.md)');
    expect(lines.join('\n')).toContain('(recent1.md)');
    expect(lines.join('\n')).not.toContain('(u1.md)');
    expect(lines[1]).toContain('Codename');
    expect(read('MEMORY.md')).toContain('# Memory Index');
  });

  it('takes a backup first and reports it', () => {
    seed();
    const result = compactGroup(base, GROUP, NOW);
    expect(result.backupId).toMatch(/^memory-backup-20261029-120000$/);
    const backup = path.join(base, 'projects', GROUP, result.backupId);
    expect(readdirSync(backup).toSorted()).toContain('u1.md');
    expect(compactionStatus(base, GROUP, NOW).backup?.id).toBe(result.backupId);
  });

  it('adds to an existing merged file instead of duplicating its sections', () => {
    seed();
    compactGroup(base, GROUP, NOW);
    put('u5.md', 'Late arrival', 'user', 'Another September fact', 36);
    put('u6.md', 'Second late arrival', 'user', 'Yet another September fact', 35);
    compactGroup(base, GROUP, NOW + 1000);

    const merged = read('merged_user_2026-09.md');
    expect(merged.match(/^## /gm)).toHaveLength(6);
    expect(merged).toContain('## Late arrival');
    expect(merged.match(/## Codename/g)).toHaveLength(1);
    const indexLines = read('MEMORY.md')
      .split('\n')
      .filter((l) => l.includes('(merged_user_2026-09.md)'));
    expect(indexLines).toHaveLength(1);
  });

  it('does nothing and makes no backup when there is nothing old enough to fold', () => {
    put('a.md', 'A', 'user', 'x', 1);
    put('b.md', 'B', 'user', 'y', 2);
    const result = compactGroup(base, GROUP, NOW);
    expect(result).toMatchObject({ merged: 0, mergedInto: 0, kept: 2, backupId: '' });
    expect(readdirSync(path.join(base, 'projects', GROUP)).some((n) => n.startsWith('memory-backup-'))).toBe(false);
  });

  it('puts everything back if it fails part-way', () => {
    seed();
    // A directory where the merged file has to go makes the write fail after the backup was taken.
    mkdirSync(path.join(memDir(), 'merged_user_2026-09.md'));
    expect(() => compactGroup(base, GROUP, NOW)).toThrow();
    expect(files()).toEqual(expect.arrayContaining(['u1.md', 'u2.md', 'u3.md', 'u4.md', 'p1.md', 'p2.md']));
    expect(read('u1.md')).toContain('Code name: Beichen 7');
    expect(readdirSync(path.join(base, 'projects', GROUP)).some((n) => n.startsWith('memory-backup-'))).toBe(false);
  });

  it('keeps at most three backups', () => {
    for (let round = 0; round < 5; round++) {
      put(`r${round}a.md`, `Ra${round}`, 'user', 'x', 40);
      put(`r${round}b.md`, `Rb${round}`, 'user', 'y', 40);
      compactGroup(base, GROUP, NOW + round * 60_000);
    }
    const backups = readdirSync(path.join(base, 'projects', GROUP)).filter((n) => n.startsWith('memory-backup-'));
    expect(backups).toHaveLength(3);
  });

  it('refuses a group id that is not a directory name', () => {
    expect(() => compactGroup(base, '../x', NOW)).toThrow();
    expect(() => compactionStatus(base, 'a/b', NOW)).toThrow();
    expect(() => undoCompaction(base, '..')).toThrow();
  });
});

describe('undoCompaction', () => {
  it('brings the originals back, with their dates, and removes the merged files', () => {
    seed();
    compactGroup(base, GROUP, NOW);
    expect(undoCompaction(base, GROUP)).toMatchObject({ restored: true });

    expect(files()).toEqual(
      [
        'MEMORY.md',
        'lone.md',
        'p1.md',
        'p2.md',
        'recent1.md',
        'recent2.md',
        'u1.md',
        'u2.md',
        'u3.md',
        'u4.md',
      ].toSorted()
    );
    expect(read('u1.md')).toContain('Code name: Beichen 7');
    // The date is what groups a memory, so it has to survive the round trip.
    expect(Math.round((NOW - statSync(path.join(memDir(), 'u1.md')).mtimeMs) / DAY)).toBe(40);
    expect(read('MEMORY.md')).toContain('(u1.md)');
    expect(compactionStatus(base, GROUP, NOW).backup).toBeNull();
  });

  it('keeps a memory saved after the tidy, and its index line', () => {
    seed();
    compactGroup(base, GROUP, NOW);
    put('after.md', 'Saved after', 'user', 'new fact', 0);
    writeFileSync(path.join(memDir(), 'MEMORY.md'), `${read('MEMORY.md')}- [Saved after](after.md) — new\n`, 'utf-8');

    undoCompaction(base, GROUP);

    expect(read('after.md')).toContain('new fact');
    expect(read('MEMORY.md')).toContain('(after.md)');
    expect(read('MEMORY.md')).toContain('(u1.md)');
    expect(files().some((f) => f.startsWith('merged_'))).toBe(false);
  });

  it('says so when there is nothing to undo', () => {
    seed();
    expect(undoCompaction(base, GROUP)).toEqual({ restored: false });
  });
});

it('compacts and restores a Unicode Claude project leaf while rejecting traversal', () => {
  const group = 'D--验收项目';
  const directory = path.join(base, 'projects', group, 'memory');
  mkdirSync(directory, { recursive: true });
  for (const file of ['one.md', 'two.md']) {
    const target = path.join(directory, file);
    writeFileSync(target, `---\nname: ${file}\ndescription: 旧记忆\ntype: reference\n---\n\n保留原文 ${file}`);
    const old = new Date(NOW - 40 * DAY);
    utimesSync(target, old, old);
  }
  expect(compactionStatus(base, group, NOW).mergeable).toBe(2);
  expect(compactGroup(base, group, NOW).merged).toBe(2);
  expect(undoCompaction(base, group).restored).toBe(true);
  expect(readFileSync(path.join(directory, 'one.md'), 'utf8')).toContain('保留原文 one.md');
  expect(() => compactGroup(base, '../outside', NOW)).toThrow();
});
