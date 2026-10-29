import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SHARED_GROUP_ID,
  importLibraryReference,
  assertEngineMemoryFile,
  deleteEngineMemory,
  listEngineMemory,
  moveGroupsToShared,
  writeEngineMemory,
} from '@process/services/engineMemory';

let base: string;

const put = (group: string, filename: string, content: string) => {
  const dir = path.join(base, 'projects', group, 'memory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), content, 'utf-8');
};
const read = (group: string, filename: string) =>
  readFileSync(path.join(base, 'projects', group, 'memory', filename), 'utf-8');

const CONV = 'C--Users-me-AppData-Roaming-One-Work-1one-conversations-2026-10-29-dream-temp-4c69a9e9';

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'engine-memory-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('listEngineMemory', () => {
  it('always offers the shared group, even before anything was written', () => {
    const overview = listEngineMemory(base);
    expect(overview.baseDir).toBe(base);
    expect(overview.groups.map((g) => [g.id, g.kind, g.files.length])).toEqual([[SHARED_GROUP_ID, 'shared', 0]]);
  });

  it('tells shared, project and per-conversation memory apart, shared first', () => {
    put(CONV, 'MEMORY.md', '- [Role](user_role.md) — role\n');
    put('D--work-website', 'note.md', '---\nname: Site notes\n---\nbody');
    put(SHARED_GROUP_ID, 'MEMORY.md', '');
    const kinds = listEngineMemory(base).groups.map((g) => g.kind);
    expect(kinds).toEqual(['shared', 'project', 'conversation']);
  });

  it('labels a per-conversation group by its date and id instead of the long path', () => {
    put(CONV, 'MEMORY.md', '- [a](a.md)');
    const group = listEngineMemory(base).groups.find((g) => g.kind === 'conversation');
    expect(group?.label).toBe('2026-10-29 · 4c69a9e9');
  });

  it('names an entry from its front matter and puts the index first', () => {
    put(SHARED_GROUP_ID, 'a.md', '---\nname: Reply language\n---\nChinese');
    put(SHARED_GROUP_ID, 'MEMORY.md', '- [Reply language](a.md)\n');
    const shared = listEngineMemory(base).groups[0];
    expect(shared.files.map((f) => f.filename)).toEqual(['MEMORY.md', 'a.md']);
    expect(shared.files[1].name).toBe('Reply language');
  });

  it('skips a group with no memory files in it', () => {
    mkdirSync(path.join(base, 'projects', 'D--empty', 'memory'), { recursive: true });
    expect(listEngineMemory(base).groups.map((g) => g.id)).toEqual([SHARED_GROUP_ID]);
  });
});

describe('writing and deleting', () => {
  it('writes into the named group and adds the .md extension', () => {
    const target = writeEngineMemory(base, SHARED_GROUP_ID, 'prefs', 'hello');
    expect(target.endsWith(path.join('_shared', 'memory', 'prefs.md'))).toBe(true);
    expect(read(SHARED_GROUP_ID, 'prefs.md')).toBe('hello');
  });

  it('cannot be pointed outside the memory directory', () => {
    expect(() => writeEngineMemory(base, '../escape', 'x.md', 'x')).toThrow();
    expect(() => writeEngineMemory(base, 'a/b', 'x.md', 'x')).toThrow();
    // A filename is reduced to its leaf.
    const target = writeEngineMemory(base, SHARED_GROUP_ID, '../../evil.md', 'x');
    expect(path.dirname(target)).toBe(path.join(base, 'projects', SHARED_GROUP_ID, 'memory'));
  });

  it('deletes only files that sit exactly under projects/<group>/memory', () => {
    put(SHARED_GROUP_ID, 'a.md', 'a');
    const inside = path.join(base, 'projects', SHARED_GROUP_ID, 'memory', 'a.md');
    deleteEngineMemory(base, inside);
    expect(existsSync(inside)).toBe(false);

    const outside = path.join(base, 'projects', 'elsewhere.md');
    writeFileSync(outside, 'keep', 'utf-8');
    expect(() => deleteEngineMemory(base, outside)).toThrow();
    expect(() => assertEngineMemoryFile(base, path.join(base, '..', 'x.md'))).toThrow();
    expect(() => assertEngineMemoryFile(base, path.join(base, 'projects', 'g', 'memory', 'sub', 'a.md'))).toThrow();
    expect(() => assertEngineMemoryFile(base, path.join(base, 'projects', 'g', 'memory', 'a.txt'))).toThrow();
    expect(readFileSync(outside, 'utf-8')).toBe('keep');
  });
});

describe('moveGroupsToShared', () => {
  it('moves files and index lines into the shared memory and clears the old directory', () => {
    put(CONV, 'user_role.md', 'role');
    put(CONV, 'MEMORY.md', '# Memory\n- [Role](user_role.md) — role\n');
    const result = moveGroupsToShared(base, [CONV]);

    expect(result).toEqual({ moved: 1, renamed: 0, duplicates: 0 });
    expect(read(SHARED_GROUP_ID, 'user_role.md')).toBe('role');
    expect(read(SHARED_GROUP_ID, 'MEMORY.md')).toBe('- [Role](user_role.md) — role\n');
    expect(existsSync(path.join(base, 'projects', CONV))).toBe(false);
  });

  it('drops an identical file instead of copying it twice', () => {
    put(SHARED_GROUP_ID, 'a.md', 'same');
    put(CONV, 'a.md', 'same');
    expect(moveGroupsToShared(base, [CONV])).toEqual({ moved: 0, renamed: 0, duplicates: 1 });
    expect(readdirSync(path.join(base, 'projects', SHARED_GROUP_ID, 'memory'))).toEqual(['a.md']);
  });

  it('keeps both versions when the same name holds different content, and repoints the index', () => {
    put(SHARED_GROUP_ID, 'a.md', 'shared version');
    put(CONV, 'a.md', 'older version');
    put(CONV, 'MEMORY.md', '- [A](a.md) — a\n');
    const result = moveGroupsToShared(base, [CONV]);

    expect(result.renamed).toBe(1);
    const files = readdirSync(path.join(base, 'projects', SHARED_GROUP_ID, 'memory')).toSorted();
    const renamed = `a-${CONV.slice(-8)}.md`;
    expect(files).toEqual(['MEMORY.md', 'a.md', renamed].toSorted());
    expect(read(SHARED_GROUP_ID, renamed)).toBe('older version');
    expect(read(SHARED_GROUP_ID, 'a.md')).toBe('shared version');
    expect(read(SHARED_GROUP_ID, 'MEMORY.md')).toContain(`(${renamed})`);
  });

  it('does not repeat an index line the shared memory already has', () => {
    put(SHARED_GROUP_ID, 'MEMORY.md', '- [Role](user_role.md) — role\n');
    put(CONV, 'MEMORY.md', '- [Role](user_role.md) — role\n- [Tone](tone.md) — tone\n');
    put(CONV, 'tone.md', 'tone');
    moveGroupsToShared(base, [CONV]);
    expect(read(SHARED_GROUP_ID, 'MEMORY.md')).toBe('- [Role](user_role.md) — role\n- [Tone](tone.md) — tone\n');
  });

  it('refuses a group id that is not a directory name', () => {
    expect(() => moveGroupsToShared(base, ['../x'])).toThrow();
  });
});

describe('importLibraryReference', () => {
  it('copies the full reference and appends a compact Unicode-safe index without overwriting existing memory', () => {
    put(SHARED_GROUP_ID, 'MEMORY.md', '# Existing\n- [Old](old.md) — keep\n');
    const original = read(SHARED_GROUP_ID, 'MEMORY.md');
    const result = importLibraryReference(base, {
      title: '文档: 中文参考',
      description: '关键词🌟'.repeat(40),
      content: '正文\n第二行',
    });
    const text = read(SHARED_GROUP_ID, result.filename);
    expect(text.endsWith('正文\n第二行')).toBe(true);
    const index = read(SHARED_GROUP_ID, 'MEMORY.md');
    expect(index.startsWith(original)).toBe(true);
    expect(Array.from(index.trimEnd().split('\n').at(-1)!).length).toBeLessThanOrEqual(120);
    expect(listEngineMemory(base).groups[0].files.find((f) => f.filename === result.filename)?.name).toBe(
      '文档: 中文参考'
    );
  });
  it('keeps two same-title copies as separate references', () => {
    const input = { title: 'Report', description: 'report', content: 'Reference text' };
    const first = importLibraryReference(base, input);
    const second = importLibraryReference(base, input);
    expect(first.filename).not.toBe(second.filename);
    expect(read(SHARED_GROUP_ID, first.filename)).toBe(read(SHARED_GROUP_ID, second.filename));
  });
  it('rejects empty or oversized references before creating memory files', () => {
    expect(() => importLibraryReference(base, { title: 'Empty', description: '', content: ' ' })).toThrow();
    expect(() =>
      importLibraryReference(base, { title: 'Large', description: '', content: '中'.repeat(400000) })
    ).toThrow('1 MiB');
    expect(existsSync(path.join(base, 'projects'))).toBe(false);
  });
  it('does not leave a new memory when the existing index cannot be read', () => {
    const directory = path.join(base, 'projects', SHARED_GROUP_ID, 'memory');
    mkdirSync(path.join(directory, 'MEMORY.md'), { recursive: true });
    expect(() => importLibraryReference(base, { title: 'Report', description: 'report', content: 'text' })).toThrow();
    expect(readdirSync(directory)).toEqual(['MEMORY.md']);
  });
});
