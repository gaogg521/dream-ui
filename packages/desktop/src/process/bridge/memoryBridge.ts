/**
 * Copyright 2026 One Work
 */

/**
 * Memory Bridge — 读写 Claude Code 记忆文件
 * 支持: ~/.claude/projects/{sanitized}/memory/*.md、~/.claude/CLAUDE.md、项目 CLAUDE.md
 *
 * 项目根路径优先用配置 (memory.claudeProjectRoot)，否则回退 getSystemDir().workDir。
 * 仅桌面端 Electron IPC；文件操作在本机主进程执行。
 */

import { ipcBridge } from '@/common';
import type { MemoryFileEntry, MemoryScopeInfo } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, shell } from 'electron';
import { getSystemDir, ProcessConfig } from '@process/utils/initStorage';
import { listAgents, readAgentFile, resolveAgentFile, writeAgentFile } from '@process/services/engineMemory/agentFiles';
import { compactGroup, compactionStatus, undoCompaction } from '@process/services/engineMemory/compact';
import {
  deleteEngineMemory,
  importLibraryReference,
  listEngineMemory,
  moveGroupsToShared,
  writeEngineMemory,
} from '@process/services/engineMemory';

function sanitizePathForClaude(p: string): string {
  // Claude Code stores project memory at ~/.claude/projects/{sanitized}/memory/
  return path.resolve(p).replace(/[:/\\]/g, '-');
}

function getWorkspaceFromConversation(c: TChatConversation): string | undefined {
  const w = (c.extra as { workspace?: string } | undefined)?.workspace;
  return typeof w === 'string' && w.trim() ? w.trim() : undefined;
}

async function fetchRecentWorkspaces(): Promise<string[]> {
  const roots: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw?.trim()) return;
    let r: string;
    try {
      r = path.resolve(raw.trim());
    } catch {
      return;
    }
    const key = r.replace(/[/\\]+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(r);
  };

  try {
    let cursor: string | undefined;
    const pageSize = 50;
    for (let i = 0; i < 6 && roots.length < 28; i++) {
      const page = await ipcBridge.database.getUserConversations.invoke({ cursor, limit: pageSize });
      for (const c of page.items ?? []) {
        add(getWorkspaceFromConversation(c));
        if (roots.length >= 28) break;
      }
      cursor = page.items?.[page.items.length - 1]?.id;
      if (!page.has_more || !cursor) break;
    }
  } catch {
    /* ignore */
  }
  return roots;
}

async function resolveClaudeProjectRoot(): Promise<string> {
  const configured = await ProcessConfig.get('memory.claudeProjectRoot').catch((): undefined => undefined);
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  if (trimmed) {
    return path.resolve(trimmed);
  }
  return getSystemDir().workDir;
}

async function resolveClaudeProjectExtraRoots(): Promise<string[]> {
  const configured = await ProcessConfig.get('memory.claudeProjectExtraRoots').catch((): undefined => undefined);
  if (!Array.isArray(configured)) return [];
  return configured
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => normalizeRootInput(item.trim()));
}

function normalizeRootInput(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  try {
    if (existsSync(resolved) && statSync(resolved).isFile()) {
      return path.dirname(resolved);
    }
  } catch {
    // ignore
  }
  return resolved;
}

function getMemoryDir(projectRoot: string): string {
  const sanitized = sanitizePathForClaude(projectRoot);
  return path.join(os.homedir(), '.claude', 'projects', sanitized, 'memory');
}

function getGlobalClaudePath(): string {
  return path.join(os.homedir(), '.claude', 'CLAUDE.md');
}

function resolveProjectClaudePaths(projectRoot: string): { readPath: string; exists: boolean } {
  const root = path.resolve(projectRoot);
  const dotClaudePath = path.join(root, '.claude', 'CLAUDE.md');
  const rootClaudePath = path.join(root, 'CLAUDE.md');
  if (existsSync(dotClaudePath)) {
    return { readPath: dotClaudePath, exists: true };
  }
  if (existsSync(rootClaudePath)) {
    return { readPath: rootClaudePath, exists: true };
  }
  return { readPath: dotClaudePath, exists: false };
}

function getNewProjectClaudePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), '.claude', 'CLAUDE.md');
}

function parseEntryName(filename: string, content: string): string {
  const match = content.match(/^name:\s*(.+?)$/m);
  if (match) return match[1].trim();
  return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

async function buildScopeInfo(): Promise<MemoryScopeInfo> {
  const appWorkDir = getSystemDir().workDir;
  const configuredRaw = await ProcessConfig.get('memory.claudeProjectRoot').catch((): undefined => undefined);
  const configuredRoot =
    typeof configuredRaw === 'string' && configuredRaw.trim() ? path.resolve(configuredRaw.trim()) : null;
  const effectiveRoot = configuredRoot ?? appWorkDir;
  const extraRoots = await resolveClaudeProjectExtraRoots();
  const roots = [effectiveRoot, ...extraRoots].filter((r, index, self) => self.indexOf(r) === index);
  const memoryDirs = roots.map(getMemoryDir);
  const { readPath, exists } = resolveProjectClaudePaths(effectiveRoot);
  return {
    effectiveRoot,
    configuredRoot,
    additionalRoots: extraRoots,
    absoluteMemoryDirs: memoryDirs,
    projectClaudePath: readPath,
    projectClaudeExists: exists,
    globalClaudePath: getGlobalClaudePath(),
    appWorkDir,
  };
}

/** Where the built-in engine keeps its memory — the same resolution as the engine's own. */
function engineMemoryBase(): string {
  const override = process.env.DREAM_MEMORY_DIR?.trim();
  return override ? override : path.join(app.getPath('appData'), 'dream');
}

export function initMemoryBridge(): void {
  const claudeTarget = async (expected?: string) => {
    const label = await resolveClaudeProjectRoot();
    const groupId = sanitizePathForClaude(label);
    if (expected !== undefined && expected !== groupId)
      throw new Error('The selected Claude project changed; reopen the memory action');
    return { label, groupId };
  };
  ipcBridge.memory.claudeCompactionStatus.provider(async () => {
    const target = await claudeTarget();
    return { ...compactionStatus(path.join(os.homedir(), '.claude'), target.groupId), ...target };
  });
  ipcBridge.memory.claudeCompact.provider(async ({ groupId }) =>
    compactGroup(path.join(os.homedir(), '.claude'), (await claudeTarget(groupId)).groupId)
  );
  ipcBridge.memory.claudeUndoCompaction.provider(async ({ groupId }) =>
    undoCompaction(path.join(os.homedir(), '.claude'), (await claudeTarget(groupId)).groupId)
  );
  ipcBridge.memory.engineImportReference.provider(async (input) => importLibraryReference(engineMemoryBase(), input));
  ipcBridge.memory.engineCompactionStatus.provider(async ({ groupId }) =>
    compactionStatus(engineMemoryBase(), groupId)
  );
  ipcBridge.memory.engineCompact.provider(async ({ groupId }) => compactGroup(engineMemoryBase(), groupId));
  ipcBridge.memory.engineUndoCompaction.provider(async ({ groupId }) => undoCompaction(engineMemoryBase(), groupId));
  ipcBridge.memory.agentList.provider(async () => listAgents(os.homedir()));
  ipcBridge.memory.agentRead.provider(async ({ agent, scope }) =>
    readAgentFile(os.homedir(), await resolveClaudeProjectRoot(), agent, scope)
  );
  ipcBridge.memory.agentWrite.provider(async ({ agent, scope, content }) => {
    writeAgentFile(os.homedir(), await resolveClaudeProjectRoot(), agent, scope, content);
  });
  ipcBridge.memory.agentOpen.provider(async ({ agent, scope }) => {
    const { filePath, exists } = resolveAgentFile(os.homedir(), await resolveClaudeProjectRoot(), agent, scope);
    // Opening a file that does not exist yet would fail; create it empty first so the editor has something to open.
    if (!exists) writeAgentFile(os.homedir(), await resolveClaudeProjectRoot(), agent, scope, '');
    await shell.openPath(filePath);
  });
  ipcBridge.memory.engineList.provider(async () => listEngineMemory(engineMemoryBase()));
  ipcBridge.memory.engineWrite.provider(async ({ groupId, filename, content }) => {
    writeEngineMemory(engineMemoryBase(), groupId, filename, content);
  });
  ipcBridge.memory.engineDelete.provider(async ({ path: filePath }) => {
    deleteEngineMemory(engineMemoryBase(), filePath);
  });
  ipcBridge.memory.engineMoveToShared.provider(async ({ groupIds }) =>
    moveGroupsToShared(engineMemoryBase(), groupIds)
  );
  ipcBridge.memory.getScope.provider(async () => buildScopeInfo());

  ipcBridge.memory.setClaudeProjectRoot.provider(async ({ path: rootPath }) => {
    if (rootPath === null || !String(rootPath).trim()) {
      await ProcessConfig.remove('memory.claudeProjectRoot');
      return;
    }
    const resolved = normalizeRootInput(String(rootPath).trim());
    await ProcessConfig.set('memory.claudeProjectRoot', resolved);
  });

  ipcBridge.memory.setClaudeProjectRoots.provider(async ({ path: rootPath, extraRoots }) => {
    if (rootPath === null || !String(rootPath).trim()) {
      await ProcessConfig.remove('memory.claudeProjectRoot');
    } else {
      await ProcessConfig.set('memory.claudeProjectRoot', normalizeRootInput(String(rootPath).trim()));
    }
    const normalizedExtraRoots = Array.isArray(extraRoots)
      ? extraRoots
          .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
          .map((item) => normalizeRootInput(item.trim()))
      : [];
    if (normalizedExtraRoots.length > 0) {
      await ProcessConfig.set('memory.claudeProjectExtraRoots', normalizedExtraRoots);
    } else {
      await ProcessConfig.remove('memory.claudeProjectExtraRoots');
    }
  });

  ipcBridge.memory.suggestRoots.provider(async () => {
    const workDir = getSystemDir().workDir;
    const roots = await fetchRecentWorkspaces();
    const seen = new Set(roots.map((r) => r.replace(/[/\\]+$/, '').toLowerCase()));
    const workKey = path
      .resolve(workDir)
      .replace(/[/\\]+$/, '')
      .toLowerCase();
    if (!seen.has(workKey)) {
      roots.push(path.resolve(workDir));
    }
    return roots;
  });

  ipcBridge.memory.list.provider(async () => {
    const projectRoot = await resolveClaudeProjectRoot();
    const extraRoots = await resolveClaudeProjectExtraRoots();
    const roots = [projectRoot, ...extraRoots].filter((r, index, self) => self.indexOf(r) === index);
    const dirs = roots.map(getMemoryDir);
    const fsp = await import('node:fs/promises');
    const entries: MemoryFileEntry[] = [];
    for (const dir of dirs) {
      try {
        const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.md'));
        const nested = await Promise.all(
          files.map(async (file) => {
            const filePath = path.join(dir, file);
            try {
              const content = await fsp.readFile(filePath, 'utf-8');
              const stat = statSync(filePath);
              return {
                name: parseEntryName(file, content),
                filename: file,
                path: filePath,
                content,
                updatedAt: stat.mtimeMs,
              } satisfies MemoryFileEntry;
            } catch {
              return null;
            }
          })
        );
        entries.push(...nested.filter((e): e is MemoryFileEntry => e !== null));
      } catch {
        // ignore missing dir
      }
    }
    return entries.toSorted((a, b) => b.updatedAt - a.updatedAt);
  });

  ipcBridge.memory.read.provider(async ({ filename, path: filePath }) => {
    if (filename === 'global-claude') {
      const p = getGlobalClaudePath();
      return existsSync(p) ? readFileSync(p, 'utf-8') : '';
    }
    if (filePath && typeof filePath === 'string') {
      try {
        return readFileSync(filePath, 'utf-8');
      } catch {
        return '';
      }
    }
    const projectRoot = await resolveClaudeProjectRoot();
    const resolvedPath = path.join(getMemoryDir(projectRoot), path.basename(filename));
    try {
      return readFileSync(resolvedPath, 'utf-8');
    } catch {
      return '';
    }
  });

  ipcBridge.memory.write.provider(async ({ filename, content, path: filePath }) => {
    if (filename === 'global-claude') {
      writeFileSync(getGlobalClaudePath(), content, 'utf-8');
      return;
    }
    if (filePath && typeof filePath === 'string') {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      return;
    }
    const projectRoot = await resolveClaudeProjectRoot();
    const dir = getMemoryDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    const resolvedPath = path.join(dir, path.basename(filename));
    writeFileSync(resolvedPath, content, 'utf-8');
  });

  ipcBridge.memory.delete.provider(async ({ filename, path: filePath }) => {
    const { unlinkSync } = await import('node:fs');
    const target =
      filePath && typeof filePath === 'string'
        ? filePath
        : path.join(getMemoryDir(await resolveClaudeProjectRoot()), path.basename(filename));
    if (existsSync(target)) unlinkSync(target);
  });

  ipcBridge.memory.openInEditor.provider(async ({ filename, path: filePath }) => {
    let p: string;
    if (filename === 'global-claude') {
      p = getGlobalClaudePath();
    } else if (filename === 'project-claude') {
      const projectRoot = await resolveClaudeProjectRoot();
      const { readPath, exists } = resolveProjectClaudePaths(projectRoot);
      p = exists ? readPath : getNewProjectClaudePath(projectRoot);
    } else if (filePath && typeof filePath === 'string') {
      p = filePath;
    } else {
      const projectRoot = await resolveClaudeProjectRoot();
      p = path.join(getMemoryDir(projectRoot), path.basename(filename));
    }
    await shell.openPath(p);
  });

  ipcBridge.memory.projectClaude.provider(async () => {
    const projectRoot = await resolveClaudeProjectRoot();
    const { readPath, exists } = resolveProjectClaudePaths(projectRoot);
    return {
      exists,
      content: exists ? readFileSync(readPath, 'utf-8') : '',
      path: exists ? readPath : getNewProjectClaudePath(projectRoot),
    };
  });

  ipcBridge.memory.writeProjectClaude.provider(async ({ content }) => {
    const projectRoot = await resolveClaudeProjectRoot();
    const dot = path.join(projectRoot, '.claude', 'CLAUDE.md');
    const rootFile = path.join(projectRoot, 'CLAUDE.md');
    const target = existsSync(dot) ? dot : existsSync(rootFile) ? rootFile : dot;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf-8');
  });
}
