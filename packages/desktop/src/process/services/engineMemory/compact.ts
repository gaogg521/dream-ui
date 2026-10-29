/**
 * Copyright 2026 One Work
 */

/**
 * Tidying a long memory directory, after the person agreed to it.
 *
 * Only the newest entries reach the assistant's prompt, and the rest are found by keyword, so a
 * long memory directory costs little at run time. It does get slow to scan and hard to read, and
 * its index outgrows the prompt. This folds *old* memories of the same type and month into one
 * file per group — every original is kept word for word as a `## ` section, so nothing is
 * summarised away and the keyword matching (which reads the text) still finds it.
 *
 * Recent memories are left alone, a full copy of the directory is taken first, and
 * {@link undoCompaction} puts it back.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const INDEX_FILE = 'MEMORY.md';
/** First line of the text of a merged file; the core reads it to bring in only matching sections. */
export const MERGED_MARKER = '<!-- merged-memory -->';
const MERGED_PREFIX = 'merged_';
const BACKUP_PREFIX = 'memory-backup-';
const MAX_BACKUPS = 3;
const INDEX_LINE = /^\s*[-*]\s*\[/;

/** More files than this and tidying is worth suggesting. */
export const COMPACT_THRESHOLD = 60;
/** Memories newer than this stay as they are. */
export const KEEP_RECENT_DAYS = 14;
const DAY_MS = 86_400_000;
/** Fewest old memories in a (type, month) group worth merging into one file. */
const MIN_GROUP_SIZE = 2;
const INDEX_HOOK_CHARS = 110;

export type CompactionStatus = {
  /** Memory files, not counting the index. */
  total: number;
  /** Old memories that tidying would fold together. */
  mergeable: number;
  /** Whether the directory is long enough that tidying should be offered. */
  suggested: boolean;
  backup: { id: string; createdAt: number } | null;
};

export type CompactionResult = {
  /** Original files folded away. */
  merged: number;
  /** Merged files written or extended. */
  mergedInto: number;
  /** Files left as they were. */
  kept: number;
  backupId: string;
};

const memoryDirOf = (base: string, groupId: string) => path.join(base, 'projects', groupId, 'memory');
const groupDirOf = (base: string, groupId: string) => path.join(base, 'projects', groupId);

function assertGroupId(groupId: string): void {
  if (
    !groupId ||
    groupId !== path.basename(groupId) ||
    /[<>:"/\\|?*]/.test(groupId) ||
    Array.from(groupId).some((character) => character.charCodeAt(0) < 32) ||
    groupId === '.' ||
    groupId === '..'
  ) {
    throw new Error(`Invalid memory group: ${groupId}`);
  }
}

type Parsed = { name: string; description: string; type: string; body: string };

function parseMemory(filename: string, raw: string): Parsed {
  const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const head = front?.[1] ?? '';
  const body = (front ? raw.slice(front[0].length) : raw).trim();
  const pick = (key: string) => head.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))?.[1] ?? '';
  return {
    name: pick('name') || filename.replace(/\.md$/, ''),
    description: pick('description'),
    type: pick('type').match(/^\w+/)?.[0] ?? 'reference',
    body,
  };
}

type Candidate = { filename: string; mtime: number; parsed: Parsed };

function readFiles(dir: string): { filename: string; mtime: number; raw: string }[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== INDEX_FILE);
  } catch {
    return [];
  }
  const files: { filename: string; mtime: number; raw: string }[] = [];
  for (const filename of names) {
    try {
      const filePath = path.join(dir, filename);
      files.push({ filename, mtime: statSync(filePath).mtimeMs, raw: readFileSync(filePath, 'utf-8') });
    } catch {
      // unreadable: leave it alone
    }
  }
  return files;
}

const monthOf = (mtime: number) => new Date(mtime).toISOString().slice(0, 7);

/** Old, not-yet-merged files, grouped by type and month; groups too small to be worth merging are dropped. */
function planGroups(files: ReturnType<typeof readFiles>, now: number): Map<string, Candidate[]> {
  const cutoff = now - KEEP_RECENT_DAYS * DAY_MS;
  const groups = new Map<string, Candidate[]>();
  for (const file of files) {
    if (file.filename.startsWith(MERGED_PREFIX) || file.mtime > cutoff) continue;
    const parsed = parseMemory(file.filename, file.raw);
    const key = `${parsed.type}|${monthOf(file.mtime)}`;
    groups.set(key, [...(groups.get(key) ?? []), { filename: file.filename, mtime: file.mtime, parsed }]);
  }
  for (const [key, members] of groups) {
    if (members.length < MIN_GROUP_SIZE) groups.delete(key);
  }
  return groups;
}

function backupsOf(base: string, groupId: string): { id: string; createdAt: number }[] {
  try {
    return readdirSync(groupDirOf(base, groupId))
      .filter((name) => name.startsWith(BACKUP_PREFIX))
      .map((name) => ({ id: name, createdAt: statSync(path.join(groupDirOf(base, groupId), name)).mtimeMs }))
      .toSorted((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function compactionStatus(base: string, groupId: string, now = Date.now()): CompactionStatus {
  assertGroupId(groupId);
  const files = readFiles(memoryDirOf(base, groupId));
  const mergeable = [...planGroups(files, now).values()].reduce((sum, members) => sum + members.length, 0);
  return {
    total: files.length,
    mergeable,
    suggested: files.length > COMPACT_THRESHOLD && mergeable > 0,
    backup: backupsOf(base, groupId)[0] ?? null,
  };
}

/** Copy the files of `from` into `to`, keeping their modification times: the date is what groups them. */
function copyDirFlat(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = path.join(from, name);
    const stat = statSync(source);
    if (!stat.isFile()) continue;
    const target = path.join(to, name);
    copyFileSync(source, target);
    utimesSync(target, stat.atime, stat.mtime);
  }
}

/** Remove the `.md` files of `dir`; anything that is not a regular file is left. */
function removeMarkdownFiles(dir: string): void {
  for (const name of readdirSync(dir)) {
    const target = path.join(dir, name);
    if (name.endsWith('.md') && statSync(target).isFile()) unlinkSync(target);
  }
}

function stampOf(now: number): string {
  return new Date(now)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .replace('T', '-');
}

function pruneBackups(base: string, groupId: string): void {
  for (const old of backupsOf(base, groupId).slice(MAX_BACKUPS)) {
    rmSync(path.join(groupDirOf(base, groupId), old.id), { recursive: true, force: true });
  }
}

const sectionOf = (parsed: Parsed): string =>
  `## ${parsed.name}\n${parsed.description ? `_${parsed.description}_\n\n` : ''}${parsed.body}`;

/** The `## ` headings of an already-merged file's text, in order. */
const sectionNames = (text: string): string[] => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());

function hookOf(names: string[]): string {
  const joined = names.join('、');
  return joined.length > INDEX_HOOK_CHARS ? `${joined.slice(0, INDEX_HOOK_CHARS)}…` : joined;
}

/**
 * Fold the old memories of `groupId` into per-type, per-month files.
 *
 * Takes a backup first; if anything fails afterwards the directory is put back as it was.
 */
export function compactGroup(base: string, groupId: string, now = Date.now()): CompactionResult {
  assertGroupId(groupId);
  const dir = memoryDirOf(base, groupId);
  const files = readFiles(dir);
  const groups = planGroups(files, now);
  if (groups.size === 0) {
    return { merged: 0, mergedInto: 0, kept: files.length, backupId: '' };
  }

  const backupId = `${BACKUP_PREFIX}${stampOf(now)}`;
  const backupDir = path.join(groupDirOf(base, groupId), backupId);
  copyDirFlat(dir, backupDir);

  try {
    const movedNames = new Set<string>();
    const mergedLines = new Map<string, string>();

    for (const [key, members] of groups) {
      const [type, month] = key.split('|');
      const target = `${MERGED_PREFIX}${type}_${month}.md`;
      const targetPath = path.join(dir, target);

      let existingText = '';
      if (existsSync(targetPath)) {
        const prior = parseMemory(target, readFileSync(targetPath, 'utf-8'));
        existingText = prior.body.replace(MERGED_MARKER, '').trim();
      }
      const ordered = members.toSorted((a, b) => a.mtime - b.mtime);
      const text = [existingText, ...ordered.map((m) => sectionOf(m.parsed))].filter(Boolean).join('\n\n');
      const names = sectionNames(text);
      const title = `${type} memories ${month}`;
      writeFileSync(
        targetPath,
        `---\nname: ${title}\ndescription: ${hookOf(names)}\ntype: ${type}\n---\n${MERGED_MARKER}\n\n${text}\n`,
        'utf-8'
      );
      mergedLines.set(target, `- [${title} · ${names.length}](${target}) — ${hookOf(names)}`);
      for (const member of members) movedNames.add(member.filename);
    }

    // Index: keep header text and every line for a file that stays; the merged files come first
    // (they are the oldest), then the rest in their original order.
    const indexPath = path.join(dir, INDEX_FILE);
    const lines = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8').split('\n') : [];
    const refersTo = (line: string, file: string) => line.includes(`(${file})`);
    const header = lines.filter((line) => line.trim() && !INDEX_LINE.test(line));
    const kept = lines.filter(
      (line) =>
        INDEX_LINE.test(line) &&
        ![...movedNames].some((f) => refersTo(line, f)) &&
        ![...mergedLines.keys()].some((f) => refersTo(line, f))
    );
    writeFileSync(
      indexPath,
      `${[...header, '', ...mergedLines.values(), ...kept].join('\n').replace(/\n{3,}/g, '\n\n')}\n`,
      'utf-8'
    );

    for (const filename of movedNames) unlinkSync(path.join(dir, filename));
    pruneBackups(base, groupId);
    return { merged: movedNames.size, mergedInto: groups.size, kept: files.length - movedNames.size, backupId };
  } catch (error) {
    restoreFrom(dir, backupDir);
    rmSync(backupDir, { recursive: true, force: true });
    throw error;
  }
}

/** Put `backupDir`'s files back, replacing every `.md` currently in `dir`. */
function restoreFrom(dir: string, backupDir: string): void {
  removeMarkdownFiles(dir);
  copyDirFlat(backupDir, dir);
}

/**
 * Undo the latest tidy.
 *
 * Memories saved since stay: only the merged files and the originals they replaced change back.
 * Their index lines are carried over so they remain visible to the assistant.
 */
export function undoCompaction(base: string, groupId: string): { restored: boolean; backupId?: string } {
  assertGroupId(groupId);
  const latest = backupsOf(base, groupId)[0];
  if (!latest) return { restored: false };
  const dir = memoryDirOf(base, groupId);
  const backupDir = path.join(groupDirOf(base, groupId), latest.id);

  const inBackup = new Set(readdirSync(backupDir));
  const indexPath = path.join(dir, INDEX_FILE);
  const currentIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8').split('\n') : [];
  // Files written after the tidy: not in the backup, and not a file the tidy made.
  const newer = readdirSync(dir).filter(
    (name) => name.endsWith('.md') && name !== INDEX_FILE && !name.startsWith(MERGED_PREFIX) && !inBackup.has(name)
  );
  const newerLines = currentIndex.filter((line) => INDEX_LINE.test(line) && newer.some((f) => line.includes(`(${f})`)));
  const newerContents = new Map(newer.map((name) => [name, readFileSync(path.join(dir, name))]));

  removeMarkdownFiles(dir);
  copyDirFlat(backupDir, dir);
  for (const [name, content] of newerContents) writeFileSync(path.join(dir, name), content);
  if (newerLines.length > 0) {
    const restored = existsSync(indexPath) ? readFileSync(indexPath, 'utf-8').replace(/\n*$/, '\n') : '';
    writeFileSync(indexPath, `${restored}${newerLines.join('\n')}\n`, 'utf-8');
  }
  rmSync(backupDir, { recursive: true, force: true });
  return { restored: true, backupId: latest.id };
}
