/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs';

export type OneLegacyConfigFile = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
};

export type OneConfigImportResult = {
  importedKeys: string[];
};

/**
 * 1one config keys carried over into the legacy config file, where the
 * existing runBackendMigrations pipeline (migrateConfigStorage /
 * migrateProviders / migrateLegacyMcpConfigToDb / channel assistants) picks
 * them up on the next pass. Everything not listed here is 1one-specific
 * (enterprise webui.*, acp.customAgents, memory.*, system.*, caches,
 * migration flags) and is intentionally left behind.
 */
const ONE_CONFIG_PASSTHROUGH_KEYS = [
  'language',
  'theme',
  'colorScheme',
  'ui.zoomFactor',
  'customCss',
  'css.themes',
  'css.activeThemeId',
  'tools.imageGenerationModel',
  'tools.speechToText',
  'skillsMarket.enabled',
  'workspace.pasteConfirm',
  'upload.saveToWorkspace',
  'webui.desktop.enabled',
  'webui.desktop.allowRemote',
  'webui.desktop.port',
  'acp.promptTimeout',
  'acp.agentIdleTimeout',
  'mcp.config',
  'model.config',
  'assistant.telegram.agent',
  'assistant.telegram.defaultModel',
  'assistant.lark.agent',
  'assistant.lark.defaultModel',
  'assistant.dingtalk.agent',
  'assistant.dingtalk.defaultModel',
  'assistant.weixin.agent',
  'assistant.weixin.defaultModel',
  'assistant.wecom.agent',
  'assistant.wecom.defaultModel',
] as const;

/**
 * 1one bundled these MCP servers with the app; their commands point at 1one
 * install paths and the dream bootstrap seeds its own equivalents.
 */
const ONE_BUILTIN_MCP_NAMES = new Set(['one-image-generation', 'one-web-tools', 'one-export-pdf']);

const PROVIDERS_MIGRATION_FLAG = 'migration.providersMigrated_v1';

/** Same on-disk encoding as the dream legacy config file. */
export function readOneLegacyConfig(configPath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(configPath, 'utf8');
    if (!raw.trim()) return null;
    const decoded = decodeURIComponent(Buffer.from(raw, 'base64').toString('utf8'));
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function filterImportableMcpServers(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter((server) => {
    if (!server || typeof server !== 'object') return false;
    const candidate = server as { builtin?: unknown; name?: unknown };
    if (candidate.builtin === true) return false;
    return typeof candidate.name === 'string' && !ONE_BUILTIN_MCP_NAMES.has(candidate.name);
  });
}

function isUnset(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/**
 * Merge 1one config values into the dream legacy config file. Existing
 * values always win — this only fills keys the user has not set here yet.
 */
export async function importOneLegacyConfig(
  configFile: OneLegacyConfigFile,
  oneConfigPath: string
): Promise<OneConfigImportResult> {
  const oneData = readOneLegacyConfig(oneConfigPath);
  const importedKeys: string[] = [];
  if (!oneData) {
    return { importedKeys };
  }

  const candidates = ONE_CONFIG_PASSTHROUGH_KEYS.filter((key) => key in oneData)
    .map((key) => ({
      key,
      value: key === 'mcp.config' ? filterImportableMcpServers(oneData[key]) : oneData[key],
    }))
    .filter((entry) => !isUnset(entry.value));

  const existingValues = await Promise.all(
    candidates.map((entry) => configFile.get(entry.key).catch((): unknown => undefined))
  );
  const toImport = candidates.filter((_, index) => isUnset(existingValues[index]));

  // Sets are serialized by the config file's internal write chain.
  await Promise.all(toImport.map((entry) => configFile.set(entry.key, entry.value)));
  importedKeys.push(...toImport.map((entry) => entry.key));

  // migrateProviders marks itself done even when model.config was absent, so
  // an earlier boot of this install would have latched the flag before the
  // 1one providers arrived. Re-arm it; the by-id filter keeps this replay
  // from resurrecting providers the user deleted (none exist on first boot).
  if (importedKeys.includes('model.config')) {
    await configFile.set(PROVIDERS_MIGRATION_FLAG, false);
  }

  return { importedKeys };
}
