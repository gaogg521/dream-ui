/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * B2: migrate 1ONE ClaudeCode custom ACP agents (`acp.customAgents`, the
 * non-preset entries) into the backend's custom-agent catalog.
 *
 * 1one stored user-configured ACP backends as `AcpBackendConfig[]` under the
 * `acp.customAgents` config key. The non-`isPreset` entries are real custom
 * runtimes (a spawn command + args + env), structurally the same thing the
 * fork models as a custom `ManagedAgent` created via `POST /api/agents/custom`.
 * The preset entries are personas and are out of scope here (personas come in
 * through the assistant migration path).
 *
 * This runs in the post-backend migration pipeline (createCustomAgent is an
 * HTTP call to the running backend), reading the 1one source config directly —
 * `acp.customAgents` is intentionally NOT in the pre-backend config passthrough
 * whitelist, so the values are not mirrored into the fork config.
 */

import path from 'path';

import { ipcBridge } from '@/common';
import type { ProcessConfig as ProcessConfigType } from '@process/utils/initStorage';

import { readOneLegacyConfig } from './importOneLegacyConfig';
import { resolveOneSourceRoot } from './index';

type ConfigFile = typeof ProcessConfigType;

/**
 * Loose view over the config file for reading/writing the migration flag,
 * which is not part of the typed config-key surface. Same escape hatch
 * `migrateAssistants` uses for `migration.assistantsMigrated_v1`.
 */
type LooseConfigAccessor = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<unknown>;
};

/**
 * Local config flag: the 1one custom-agent migration has completed once on
 * this machine. Same latch rationale as `migration.assistantsMigrated_v1` —
 * without it a user-deleted custom agent would be re-imported every launch.
 */
const ONE_CUSTOM_AGENTS_FLAG = 'migration.oneCustomAgentsMigrated_v1';

/** Body accepted by `ipcBridge.acpConversation.createCustomAgent`. */
export type OneCustomAgentImport = {
  name: string;
  command: string;
  icon?: string;
  args?: string[];
  env?: Array<{ name: string; value: string; description?: string }>;
  advanced?: { native_skills_dirs?: string[]; description?: string };
};

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function envRecordToEntries(value: unknown): Array<{ name: string; value: string }> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries: Array<{ name: string; value: string }> = [];
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && name.trim().length > 0) {
      entries.push({ name, value: raw });
    }
  }
  return entries.length > 0 ? entries : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return arr.length > 0 ? arr : undefined;
}

/**
 * Map one 1one `AcpBackendConfig` (non-preset) into the fork's custom-agent
 * create body. Returns `null` when the entry has no runnable spawn command
 * (nothing to create) — such rows are skipped, not failed.
 *
 * The spawn command comes from `defaultCliPath` (a full CLI path with optional
 * space-separated args), falling back to `cliCommand`. The first whitespace
 * token is the command, the rest are args.
 */
export function oneCustomAgentToImport(agent: Record<string, unknown>): OneCustomAgentImport | null {
  const name = asString(agent.name);
  if (!name) return null;

  const cliPath = asString(agent.defaultCliPath);
  const tokens = cliPath ? cliPath.split(/\s+/) : asString(agent.cliCommand) ? [asString(agent.cliCommand)!] : [];
  if (tokens.length === 0) return null;

  const [command, ...args] = tokens;
  const env = envRecordToEntries(agent.env);
  const nativeSkillsDirs = stringArray(agent.skillsDirs);
  const description = asString(agent.description);

  const advanced =
    nativeSkillsDirs || description
      ? {
          ...(nativeSkillsDirs ? { native_skills_dirs: nativeSkillsDirs } : {}),
          ...(description ? { description } : {}),
        }
      : undefined;

  return {
    name,
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(asString(agent.avatar) ? { icon: asString(agent.avatar) } : {}),
    ...(env ? { env } : {}),
    ...(advanced ? { advanced } : {}),
  };
}

/**
 * Read the 1one source config and return the non-preset custom agents mapped
 * into create bodies. Empty when there is no 1one install, no config, or no
 * custom agents. Pure apart from the file read; exported for testing via
 * `sourceRoot` injection.
 */
export function collectOneCustomAgents(sourceRoot: string): OneCustomAgentImport[] {
  const oneConfig = readOneLegacyConfig(path.join(sourceRoot, 'config', 'one-config.txt'));
  const raw = oneConfig?.['acp.customAgents'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === 'object' && !(entry as Record<string, unknown>).isPreset
    )
    .map(oneCustomAgentToImport)
    .filter((body): body is OneCustomAgentImport => body !== null);
}

/**
 * Post-backend migration step: import 1one custom agents once. Idempotent via
 * the completion flag plus a name-dedup against the backend's existing custom
 * agents (so a re-run before the flag latches doesn't create duplicates).
 *
 * Returns `true` on success (including the no-op cases); `false` on a partial
 * import so the pipeline retries on the next launch. Mirrors the
 * `migrateAssistantsToBackend` contract.
 */
export async function migrateOneCustomAgents(configFile: ConfigFile): Promise<boolean> {
  if (process.env.AIONUI_SKIP_ELECTRON_MIGRATION === '1') {
    return false;
  }

  const accessor = configFile as unknown as LooseConfigAccessor;
  const setFlag = () => accessor.set(ONE_CUSTOM_AGENTS_FLAG, true).catch((): unknown => undefined);

  let alreadyMigrated = false;
  try {
    alreadyMigrated = Boolean(await accessor.get(ONE_CUSTOM_AGENTS_FLAG));
  } catch {
    // Treat read errors as "not migrated"; the flag is set on success.
  }
  if (alreadyMigrated) return true;

  const sourceRoot = resolveOneSourceRoot();
  if (!sourceRoot) {
    // No 1one install to migrate from — latch so we stop looking.
    await setFlag();
    return true;
  }

  const candidates = collectOneCustomAgents(sourceRoot);
  if (candidates.length === 0) {
    await setFlag();
    return true;
  }

  // Dedup by name against existing custom agents so a retry (before the flag
  // latches) does not create duplicates.
  const existing = await ipcBridge.acpConversation.getManagedAgents.invoke().catch(() => [] as unknown[]);
  const existingCustomNames = new Set(
    (Array.isArray(existing) ? existing : [])
      .filter((a) => (a as Record<string, unknown>)?.agent_source === 'custom')
      .map((a) => (a as Record<string, unknown>).name)
      .filter((n): n is string => typeof n === 'string')
  );
  const toImport = candidates.filter((body) => !existingCustomNames.has(body.name));

  // Parallel — each create is independent and the set is small. Mirrors the
  // Promise.allSettled fan-out in migrateAssistants' override phases.
  const results = await Promise.allSettled(
    toImport.map((body) => ipcBridge.acpConversation.createCustomAgent.invoke(body))
  );
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failed += 1;
      console.error(`[AionUi] Failed to import 1one custom agent '${toImport[index].name}':`, result.reason);
    }
  });

  if (failed > 0) {
    console.error(`[AionUi] 1one custom agent migration partial: ${failed}/${toImport.length} failed`);
    return false;
  }
  if (toImport.length > 0) {
    console.log(`[AionUi] Migrated ${toImport.length} 1one custom agent(s)`);
  }
  await setFlag();
  return true;
}
