import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listAgents, readAgentFile, resolveAgentFile, writeAgentFile } from '@process/services/engineMemory/agentFiles';

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'agent-home-'));
  project = mkdtempSync(path.join(os.tmpdir(), 'agent-project-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe('listAgents', () => {
  it('marks an agent as used when its config directory exists', () => {
    mkdirSync(path.join(home, '.codex'));
    mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
    const used = Object.fromEntries(listAgents(home).map((a) => [a.key, a.used]));
    expect(used).toEqual({ claude: false, codex: true, gemini: false, opencode: true });
  });

  it("reports each agent's documented global file and whether it exists", () => {
    mkdirSync(path.join(home, '.gemini'));
    writeFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'hi');
    const byKey = Object.fromEntries(listAgents(home).map((a) => [a.key, a]));
    expect(byKey.gemini.globalPath).toBe(path.join(home, '.gemini', 'GEMINI.md'));
    expect(byKey.gemini.globalExists).toBe(true);
    expect(byKey.codex.globalPath).toBe(path.join(home, '.codex', 'AGENTS.md'));
    expect(byKey.opencode.globalPath).toBe(path.join(home, '.config', 'opencode', 'AGENTS.md'));
    expect(byKey.claude.globalPath).toBe(path.join(home, '.claude', 'CLAUDE.md'));
    expect(byKey.codex.globalExists).toBe(false);
  });
});

describe('reading and writing', () => {
  it('reads an existing global file and reports a missing one as empty', () => {
    mkdirSync(path.join(home, '.codex'));
    writeFileSync(path.join(home, '.codex', 'AGENTS.md'), 'be concise');
    expect(readAgentFile(home, project, 'codex', 'global')).toMatchObject({ exists: true, content: 'be concise' });
    expect(readAgentFile(home, project, 'gemini', 'global')).toMatchObject({ exists: false, content: '' });
  });

  it('creates the directory when writing a global file for an agent that has none yet', () => {
    writeAgentFile(home, project, 'gemini', 'global', 'use metric units');
    expect(readFileSync(path.join(home, '.gemini', 'GEMINI.md'), 'utf-8')).toBe('use metric units');
  });

  it('finds the project file an agent already has, preferring the first location', () => {
    writeFileSync(path.join(project, 'CLAUDE.md'), 'root one');
    expect(resolveAgentFile(home, project, 'claude', 'project')).toEqual({
      filePath: path.join(project, 'CLAUDE.md'),
      exists: true,
    });
    mkdirSync(path.join(project, '.claude'));
    writeFileSync(path.join(project, '.claude', 'CLAUDE.md'), 'dot one');
    expect(readAgentFile(home, project, 'claude', 'project').content).toBe('dot one');
  });

  it('creates a missing project file where that agent expects it', () => {
    writeAgentFile(home, project, 'claude', 'project', 'x');
    expect(existsSync(path.join(project, '.claude', 'CLAUDE.md'))).toBe(true);
    writeAgentFile(home, project, 'codex', 'project', 'y');
    expect(readFileSync(path.join(project, 'AGENTS.md'), 'utf-8')).toBe('y');
  });

  it('only ever touches the fixed paths: an unknown agent or scope is refused', () => {
    expect(() => readAgentFile(home, project, '../etc', 'global')).toThrow('Unknown agent');
    expect(() => writeAgentFile(home, project, 'constructor', 'global', 'x')).toThrow('Unknown agent');
    // @ts-expect-error — a scope the renderer is not allowed to name
    expect(() => readAgentFile(home, project, 'codex', '../../secret')).toThrow('Unknown scope');
  });
});
