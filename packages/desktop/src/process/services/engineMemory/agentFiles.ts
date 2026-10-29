/**
 * Copyright 2026 One Work
 */

/**
 * The instruction ("memory") files other coding agents read, one pair per agent: a global file in
 * the agent's own config directory, and a file in the project folder.
 *
 * The locations are the ones each tool documents: Claude Code `~/.claude/CLAUDE.md`, Codex
 * `~/.codex/AGENTS.md`, Gemini CLI `~/.gemini/GEMINI.md`, OpenCode `~/.config/opencode/AGENTS.md`.
 * Only these fixed paths can be read or written through here — the renderer names an agent and a
 * scope, never a path.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentMemoryFile, AgentMemoryInfo, AgentMemoryKey, AgentMemoryScope } from '@/common/adapter/ipcBridge';

type AgentSpec = {
  label: string;
  /** Config directory, relative to the home directory. */
  configDir: string[];
  /** The global instruction file, relative to the home directory. */
  globalFile: string[];
  /** Project-folder file names in the order they are looked for; the first is created when none exists. */
  projectFiles: string[];
};

const AGENTS: Record<AgentMemoryKey, AgentSpec> = {
  claude: {
    label: 'Claude Code',
    configDir: ['.claude'],
    globalFile: ['.claude', 'CLAUDE.md'],
    projectFiles: [path.join('.claude', 'CLAUDE.md'), 'CLAUDE.md'],
  },
  codex: {
    label: 'Codex',
    configDir: ['.codex'],
    globalFile: ['.codex', 'AGENTS.md'],
    projectFiles: ['AGENTS.md'],
  },
  gemini: {
    label: 'Gemini CLI',
    configDir: ['.gemini'],
    globalFile: ['.gemini', 'GEMINI.md'],
    projectFiles: ['GEMINI.md'],
  },
  opencode: {
    label: 'OpenCode',
    configDir: ['.config', 'opencode'],
    globalFile: ['.config', 'opencode', 'AGENTS.md'],
    projectFiles: ['AGENTS.md'],
  },
};

export const AGENT_MEMORY_KEYS = Object.keys(AGENTS) as AgentMemoryKey[];

function specOf(agent: string): AgentSpec {
  if (!Object.prototype.hasOwnProperty.call(AGENTS, agent)) throw new Error(`Unknown agent: ${agent}`);
  return AGENTS[agent as AgentMemoryKey];
}

const isDirectory = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

function projectPathOf(spec: AgentSpec, projectRoot: string): { filePath: string; exists: boolean } {
  const root = path.resolve(projectRoot);
  for (const name of spec.projectFiles) {
    const candidate = path.join(root, name);
    if (existsSync(candidate)) return { filePath: candidate, exists: true };
  }
  return { filePath: path.join(root, spec.projectFiles[0]), exists: false };
}

export function resolveAgentFile(
  home: string,
  projectRoot: string,
  agent: string,
  scope: AgentMemoryScope
): { filePath: string; exists: boolean } {
  const spec = specOf(agent);
  if (scope === 'global') {
    const filePath = path.join(home, ...spec.globalFile);
    return { filePath, exists: existsSync(filePath) };
  }
  if (scope === 'project') return projectPathOf(spec, projectRoot);
  throw new Error(`Unknown scope: ${String(scope)}`);
}

/** Every supported agent; `used` is true when its config directory exists on this computer. */
export function listAgents(home: string): AgentMemoryInfo[] {
  return AGENT_MEMORY_KEYS.map((key) => {
    const spec = AGENTS[key];
    const globalPath = path.join(home, ...spec.globalFile);
    return {
      key,
      label: spec.label,
      used: isDirectory(path.join(home, ...spec.configDir)),
      globalPath,
      globalExists: existsSync(globalPath),
      projectFileName: spec.projectFiles[0],
    };
  });
}

export function readAgentFile(
  home: string,
  projectRoot: string,
  agent: string,
  scope: AgentMemoryScope
): AgentMemoryFile {
  const { filePath, exists } = resolveAgentFile(home, projectRoot, agent, scope);
  return { path: filePath, exists, content: exists ? readFileSync(filePath, 'utf-8') : '' };
}

export function writeAgentFile(
  home: string,
  projectRoot: string,
  agent: string,
  scope: AgentMemoryScope,
  content: string
): string {
  const { filePath } = resolveAgentFile(home, projectRoot, agent, scope);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
