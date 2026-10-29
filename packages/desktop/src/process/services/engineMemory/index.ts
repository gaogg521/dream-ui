/**
 * Copyright 2026 One Work
 */

/**
 * The built-in engine's own memory: `<base>/projects/<group>/memory/*.md`.
 *
 * `<base>` is `DREAM_MEMORY_DIR`, or `<appData>/dream` — the engine resolves it the same way
 * (dream-engine-memory `memory_base_dir`), so this reads exactly what the model reads and writes.
 *
 * Three kinds of group live there:
 *  - `_shared`   — memory for conversations that have no project of their own (the default for
 *                  every conversation that runs in an app-provisioned temp workspace);
 *  - `project`   — memory of a project folder the person chose;
 *  - `conversation` — what releases before the shared directory wrote: one directory per
 *                  throwaway conversation workspace, which no later conversation ever reads.
 *
 * Pure `node:fs` over an explicit base so it can be tested against a temp directory.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { EngineMemoryFile, EngineMemoryGroup, EngineMemoryOverview } from '@/common/adapter/ipcBridge';

export const SHARED_GROUP_ID = '_shared';
const INDEX_FILE = 'MEMORY.md';
/** Marker the app puts in the leaf of every workspace it provisions for a conversation. */
const CONVERSATION_MARKER = '-temp-';
const GROUP_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

const projectsDir = (base: string) => path.join(base, 'projects');
const memoryDirOf = (base: string, groupId: string) => path.join(projectsDir(base), groupId, 'memory');

function assertGroupId(groupId: string): void {
  if (!GROUP_ID_PATTERN.test(groupId) || groupId === '.' || groupId === '..') {
    throw new Error(`Invalid memory group: ${groupId}`);
  }
}

/** A memory file path is acceptable only if it is exactly `<base>/projects/<group>/memory/<file>.md`. */
export function assertEngineMemoryFile(base: string, filePath: string): string {
  const resolved = path.resolve(filePath);
  const parts = path.relative(projectsDir(base), resolved).split(path.sep);
  if (parts.length !== 3 || parts[1] !== 'memory' || !resolved.endsWith('.md') || !GROUP_ID_PATTERN.test(parts[0])) {
    throw new Error('Not an engine memory file');
  }
  if (parts[0] === '.' || parts[0] === '..') throw new Error('Not an engine memory file');
  return resolved;
}

function kindOf(groupId: string): EngineMemoryGroup['kind'] {
  if (groupId === SHARED_GROUP_ID) return 'shared';
  return groupId.includes(CONVERSATION_MARKER) ? 'conversation' : 'project';
}

function entryName(filename: string, content: string): string {
  if (filename === INDEX_FILE) return filename;
  const match = content.match(/^name:\s*(.+?)$/m);
  return match ? match[1].trim() : filename.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

/** A per-conversation directory is named after a long path; what identifies it is the date and the id. */
const CONVERSATION_LEAF = /(\d{4}-\d{2}-\d{2})-[A-Za-z0-9]*-?temp-([A-Za-z0-9]+)$/;

function labelOf(id: string): string {
  const match = kindOf(id) === 'conversation' ? CONVERSATION_LEAF.exec(id) : null;
  if (match) return `${match[1]} · ${match[2]}`;
  return id.length > 48 ? `…${id.slice(-46)}` : id;
}

function readGroupFiles(dir: string): EngineMemoryFile[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const files: EngineMemoryFile[] = [];
  for (const filename of names) {
    const filePath = path.join(dir, filename);
    try {
      const content = readFileSync(filePath, 'utf-8');
      files.push({
        name: entryName(filename, content),
        filename,
        path: filePath,
        content,
        updatedAt: statSync(filePath).mtimeMs,
      });
    } catch {
      // unreadable file: leave it out rather than fail the whole listing
    }
  }
  // The index first, then newest first.
  return files.toSorted((a, b) =>
    a.filename === INDEX_FILE ? -1 : b.filename === INDEX_FILE ? 1 : b.updatedAt - a.updatedAt
  );
}

export function listEngineMemory(base: string): EngineMemoryOverview {
  const groups: EngineMemoryGroup[] = [];
  let ids: string[] = [];
  try {
    ids = readdirSync(projectsDir(base));
  } catch {
    // no engine memory written yet
  }
  for (const id of ids) {
    if (!GROUP_ID_PATTERN.test(id)) continue;
    const dir = memoryDirOf(base, id);
    const files = readGroupFiles(dir);
    if (files.length === 0 && id !== SHARED_GROUP_ID) continue;
    groups.push({
      id,
      kind: kindOf(id),
      label: labelOf(id),
      dir,
      files,
      updatedAt: files.reduce((latest, f) => Math.max(latest, f.updatedAt), 0),
    });
  }
  if (!groups.some((g) => g.id === SHARED_GROUP_ID)) {
    groups.push({
      id: SHARED_GROUP_ID,
      kind: 'shared',
      label: SHARED_GROUP_ID,
      dir: memoryDirOf(base, SHARED_GROUP_ID),
      files: [],
      updatedAt: 0,
    });
  }
  const order = { shared: 0, project: 1, conversation: 2 } as const;
  groups.sort((a, b) => order[a.kind] - order[b.kind] || b.updatedAt - a.updatedAt);
  return { baseDir: base, groups };
}

export function writeEngineMemory(base: string, groupId: string, filename: string, content: string): string {
  assertGroupId(groupId);
  const leaf = path.basename(filename);
  const name = leaf.endsWith('.md') ? leaf : `${leaf}.md`;
  const dir = memoryDirOf(base, groupId);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  writeFileSync(target, content, 'utf-8');
  return target;
}

export function deleteEngineMemory(base: string, filePath: string): void {
  const resolved = assertEngineMemoryFile(base, filePath);
  if (existsSync(resolved)) unlinkSync(resolved);
}

export type MoveToSharedResult = { moved: number; renamed: number; duplicates: number };

const INDEX_LINE = /^\s*[-*]\s*\[/;

/** A name for `filename` that is free in `dir`, derived from where it came from. */
function freeName(dir: string, filename: string, groupId: string): string {
  const stem = filename.replace(/\.md$/, '');
  const tag = groupId.slice(-8);
  let candidate = `${stem}-${tag}.md`;
  for (let n = 2; existsSync(path.join(dir, candidate)); n++) candidate = `${stem}-${tag}-${n}.md`;
  return candidate;
}

function removeIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // already gone, or not empty
  }
}

/**
 * Fold the memory of other groups into the shared one, then remove what was folded.
 *
 * A file with the same name and the same content is a duplicate and is simply dropped; the same
 * name with different content is kept under a new name so nothing the person (or the model) wrote
 * is lost. Index lines follow their file to its new name.
 */
export function moveGroupsToShared(base: string, groupIds: string[]): MoveToSharedResult {
  const result: MoveToSharedResult = { moved: 0, renamed: 0, duplicates: 0 };
  const sharedDir = memoryDirOf(base, SHARED_GROUP_ID);
  const sharedIndexPath = path.join(sharedDir, INDEX_FILE);

  for (const groupId of groupIds) {
    assertGroupId(groupId);
    if (groupId === SHARED_GROUP_ID) continue;
    const dir = memoryDirOf(base, groupId);
    if (!existsSync(dir)) continue;
    mkdirSync(sharedDir, { recursive: true });

    const renames = new Map<string, string>();
    for (const filename of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== INDEX_FILE)) {
      const source = path.join(dir, filename);
      const wanted = path.join(sharedDir, filename);
      if (existsSync(wanted)) {
        if (readFileSync(wanted, 'utf-8') === readFileSync(source, 'utf-8')) {
          unlinkSync(source);
          result.duplicates++;
          continue;
        }
        const renamedTo = freeName(sharedDir, filename, groupId);
        copyFileSync(source, path.join(sharedDir, renamedTo));
        renames.set(filename, renamedTo);
        result.renamed++;
      } else {
        copyFileSync(source, wanted);
      }
      unlinkSync(source);
      result.moved++;
    }

    const indexPath = path.join(dir, INDEX_FILE);
    if (existsSync(indexPath)) {
      const existing = existsSync(sharedIndexPath) ? readFileSync(sharedIndexPath, 'utf-8') : '';
      const have = new Set(existing.split('\n').map((l) => l.trim()));
      const added: string[] = [];
      for (const line of readFileSync(indexPath, 'utf-8').split('\n')) {
        if (!INDEX_LINE.test(line)) continue;
        let next = line.trimEnd();
        for (const [from, to] of renames) next = next.split(`(${from})`).join(`(${to})`);
        if (!have.has(next.trim())) {
          have.add(next.trim());
          added.push(next);
        }
      }
      if (added.length > 0) {
        const head = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing;
        writeFileSync(sharedIndexPath, `${head}${added.join('\n')}\n`, 'utf-8');
      }
      unlinkSync(indexPath);
    }

    removeIfEmpty(dir);
    removeIfEmpty(path.join(projectsDir(base), groupId));
  }
  return result;
}
