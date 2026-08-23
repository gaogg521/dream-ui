import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  importOneLegacyConfig,
  readOneLegacyConfig,
  type OneLegacyConfigFile,
} from '@/process/services/oneMigration/importOneLegacyConfig';

function encodeOneConfig(data: Record<string, unknown>): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(data)), 'utf8').toString('base64');
}

function makeConfigFile(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const file: OneLegacyConfigFile = {
    get: (key) => Promise.resolve(store.get(key)),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve(value);
    },
  };
  return { file, store };
}

describe('1one legacy config import', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'one-config-test-'));
    configPath = path.join(tempDir, 'one-config.txt');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('decodes the base64(encodeURIComponent(JSON)) on-disk format', () => {
    writeFileSync(configPath, encodeOneConfig({ language: 'zh-CN', theme: 'dark' }), 'utf8');
    expect(readOneLegacyConfig(configPath)).toEqual({ language: 'zh-CN', theme: 'dark' });
  });

  it('returns null for empty or corrupt files', () => {
    writeFileSync(configPath, '', 'utf8');
    expect(readOneLegacyConfig(configPath)).toBeNull();
    writeFileSync(configPath, 'not-base64-json', 'utf8');
    expect(readOneLegacyConfig(configPath)).toBeNull();
  });

  it('imports whitelisted keys and ignores 1one-specific ones', async () => {
    writeFileSync(
      configPath,
      encodeOneConfig({
        language: 'zh-CN',
        'ui.zoomFactor': 1.2,
        'acp.customAgents': [{ id: 'x' }],
        'webui.enterpriseServerUrl': 'http://internal',
        'migration.assistantEnabledFixed': true,
      }),
      'utf8'
    );
    const { file, store } = makeConfigFile();

    const result = await importOneLegacyConfig(file, configPath);

    expect(result.importedKeys.toSorted()).toEqual(['language', 'ui.zoomFactor']);
    expect(store.get('language')).toBe('zh-CN');
    expect(store.has('acp.customAgents')).toBe(false);
    expect(store.has('webui.enterpriseServerUrl')).toBe(false);
    expect(store.has('migration.assistantEnabledFixed')).toBe(false);
  });

  it('never clobbers values the user already set here', async () => {
    writeFileSync(configPath, encodeOneConfig({ language: 'zh-CN', theme: 'dark' }), 'utf8');
    const { file, store } = makeConfigFile({ language: 'en-US' });

    const result = await importOneLegacyConfig(file, configPath);

    expect(store.get('language')).toBe('en-US');
    expect(store.get('theme')).toBe('dark');
    expect(result.importedKeys).toEqual(['theme']);
  });

  it('treats an empty array as unset on both sides', async () => {
    writeFileSync(configPath, encodeOneConfig({ 'model.config': [{ id: 'p1', platform: 'custom' }] }), 'utf8');
    const { file, store } = makeConfigFile({ 'model.config': [] });

    const result = await importOneLegacyConfig(file, configPath);

    expect(result.importedKeys).toEqual(['model.config']);
    expect(store.get('model.config')).toEqual([{ id: 'p1', platform: 'custom' }]);
  });

  it('filters 1one builtin MCP servers but keeps user-defined ones', async () => {
    writeFileSync(
      configPath,
      encodeOneConfig({
        'mcp.config': [
          { name: 'one-image-generation', builtin: true, transport: { type: 'stdio' } },
          { name: 'one-web-tools', transport: { type: 'stdio' } },
          { name: 'chrome-devtools', enabled: true, transport: { type: 'stdio' } },
          { name: 'my-custom', transport: { type: 'stdio' } },
        ],
      }),
      'utf8'
    );
    const { file, store } = makeConfigFile();

    await importOneLegacyConfig(file, configPath);

    const servers = store.get('mcp.config') as Array<{ name: string }>;
    expect(servers.map((s) => s.name).toSorted()).toEqual(['chrome-devtools', 'my-custom']);
  });

  it('re-arms the providers migration flag when model.config is imported', async () => {
    writeFileSync(configPath, encodeOneConfig({ 'model.config': [{ id: 'p1' }] }), 'utf8');
    const { file, store } = makeConfigFile({ 'migration.providersMigrated_v1': true });

    await importOneLegacyConfig(file, configPath);

    expect(store.get('migration.providersMigrated_v1')).toBe(false);
  });

  it('leaves the providers flag alone when model.config was not imported', async () => {
    writeFileSync(configPath, encodeOneConfig({ language: 'zh-CN' }), 'utf8');
    const { file, store } = makeConfigFile({ 'migration.providersMigrated_v1': true });

    await importOneLegacyConfig(file, configPath);

    expect(store.get('migration.providersMigrated_v1')).toBe(true);
  });
});
