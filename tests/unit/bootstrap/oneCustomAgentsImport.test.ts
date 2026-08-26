/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the 1one custom-agent migration mapper (B2).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock heavy / runtime-only deps so the pure mapper loads in isolation.
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: {
      getManagedAgents: { invoke: vi.fn(async () => []) },
      createCustomAgent: { invoke: vi.fn() },
    },
  },
}));
vi.mock('@process/services/oneMigration/index', () => ({
  resolveOneSourceRoot: vi.fn(() => null),
}));

import { collectOneCustomAgents, oneCustomAgentToImport } from '@/process/services/oneMigration/importOneCustomAgents';

function encodeOneConfig(data: Record<string, unknown>): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(data)), 'utf8').toString('base64');
}

describe('1one custom-agent mapper (B2)', () => {
  describe('oneCustomAgentToImport', () => {
    it('maps a full custom agent, splitting defaultCliPath into command + args', () => {
      const body = oneCustomAgentToImport({
        id: 'my-agent',
        name: '  My Agent  ',
        avatar: '🤖',
        description: '一个自定义 agent',
        defaultCliPath: 'npx @acme/my-agent --acp --verbose',
        env: { MY_API_KEY: 'sk-123', DEBUG: 'true' },
        skillsDirs: ['.acme/skills'],
      });
      expect(body).toEqual({
        name: 'My Agent',
        command: 'npx',
        args: ['@acme/my-agent', '--acp', '--verbose'],
        icon: '🤖',
        env: [
          { name: 'MY_API_KEY', value: 'sk-123' },
          { name: 'DEBUG', value: 'true' },
        ],
        advanced: { native_skills_dirs: ['.acme/skills'], description: '一个自定义 agent' },
      });
    });

    it('falls back to cliCommand when defaultCliPath is absent', () => {
      const body = oneCustomAgentToImport({ name: 'Goose', cliCommand: 'goose' });
      expect(body).toEqual({ name: 'Goose', command: 'goose' });
    });

    it('returns null without a name or a runnable command', () => {
      expect(oneCustomAgentToImport({ defaultCliPath: 'foo' })).toBeNull();
      expect(oneCustomAgentToImport({ name: '   ' })).toBeNull();
      expect(oneCustomAgentToImport({ name: 'No Command' })).toBeNull();
    });
  });

  describe('collectOneCustomAgents', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'one-custom-agents-'));
      mkdirSync(path.join(tempDir, 'config'), { recursive: true });
    });
    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    function writeConfig(data: Record<string, unknown>) {
      writeFileSync(path.join(tempDir, 'config', 'one-config.txt'), encodeOneConfig(data), 'utf8');
    }

    it('collects non-preset custom agents, skipping presets and unrunnable rows', () => {
      writeConfig({
        'acp.customAgents': [
          { id: 'custom-1', name: 'Custom One', defaultCliPath: 'my-cli --acp' },
          { id: 'preset-1', name: 'A Persona', isPreset: true, presetAgentType: 'claude' },
          { id: 'no-cmd', name: 'No Command' },
        ],
      });
      const agents = collectOneCustomAgents(tempDir);
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Custom One');
      expect(agents[0].command).toBe('my-cli');
    });

    it('returns empty when there is no config or no custom agents', () => {
      expect(collectOneCustomAgents(tempDir)).toEqual([]);
      writeConfig({ 'acp.customAgents': [] });
      expect(collectOneCustomAgents(tempDir)).toEqual([]);
      writeConfig({ language: 'zh-CN' });
      expect(collectOneCustomAgents(tempDir)).toEqual([]);
    });
  });
});
