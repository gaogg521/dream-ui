/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { getDataPath, resolveWithLegacyName } from '@process/utils';
import type { ISqliteDriver } from '@process/services/database/drivers/ISqliteDriver';
import { runMigrations } from '@process/services/database/migrations';
import { repairLegacyHandoffSchema } from '@process/services/database/repairLegacyHandoffSchema';
import {
  CURRENT_DB_VERSION,
  getDatabaseVersion,
  initSchema,
  setDatabaseVersion,
} from '@process/services/database/schema';

const DEFAULT_USER_ID = 'system_default_user';

/** Tables present in the 1one catalog that have no dreamcore counterpart. */
export const ONE_SKIPPED_TABLES = [
  'tasks',
  'team_memberships',
  'tenants',
  'personal_agents',
  'auth_providers',
  'requirements',
  'audit_logs',
  'assistant_plugins',
] as const;

export type OneDbImportResult = {
  targetDb: string;
  backupPath: string | null;
  counts: Record<string, number>;
  skippedTables: string[];
};

/**
 * 1one stored a few things differently from the dreamcore baseline:
 * - `pinned` / `pinnedAt` lived inside `conversations.extra` (no columns) —
 *   promoted to the real columns at INSERT time, stripped here.
 * - `enabledSkills` / `excludeBuiltinSkills` are camelCase; the backend's
 *   legacy-alias path reads `enabled_skills` / `exclude_builtin_skills`.
 * All statements are key-guarded and idempotent, mirroring the style of
 * dreamcore migration 002.
 */
const ONE_EXTRA_NORMALIZE_SQL = `
UPDATE conversations SET extra = json_remove(extra, '$.pinned', '$.pinnedAt')
WHERE json_extract(extra, '$.pinned') IS NOT NULL OR json_extract(extra, '$.pinnedAt') IS NOT NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.enabledSkills'), '$.enabled_skills', json_extract(extra, '$.enabledSkills'))
WHERE json_extract(extra, '$.enabledSkills') IS NOT NULL
  AND json_extract(extra, '$.enabled_skills') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.excludeBuiltinSkills'), '$.exclude_builtin_skills', json_extract(extra, '$.excludeBuiltinSkills'))
WHERE json_extract(extra, '$.excludeBuiltinSkills') IS NOT NULL
  AND json_extract(extra, '$.exclude_builtin_skills') IS NULL;
`;

/**
 * Verbatim copy of dreamcore migration 002 Parts A/B/C (data normalization).
 * The backend runs 002 exactly once per database, so rows imported after that
 * point must be normalized here. Every statement is conditional / idempotent,
 * so re-running over already-normalized rows is a no-op. Part D (table
 * rebuilds) is intentionally omitted — the target tables already carry the
 * post-002 DDL. Part E (acp_session backfill) is applied separately because
 * the table only exists in backend-managed catalogs.
 */
const AIONCORE_002_NORMALIZE_SQL = `
UPDATE conversations
SET extra = json_set(json_remove(extra, '$.agentName'), '$.agent_name', json_extract(extra, '$.agentName'))
WHERE json_extract(extra, '$.agentName') IS NOT NULL
  AND json_extract(extra, '$.agent_name') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.cliPath'), '$.cli_path', json_extract(extra, '$.cliPath'))
WHERE json_extract(extra, '$.cliPath') IS NOT NULL
  AND json_extract(extra, '$.cli_path') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.currentModelId'), '$.current_model_id', json_extract(extra, '$.currentModelId'))
WHERE json_extract(extra, '$.currentModelId') IS NOT NULL
  AND json_extract(extra, '$.current_model_id') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.sessionMode'), '$.session_mode', json_extract(extra, '$.sessionMode'))
WHERE json_extract(extra, '$.sessionMode') IS NOT NULL
  AND json_extract(extra, '$.session_mode') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.customWorkspace'), '$.custom_workspace', json_extract(extra, '$.customWorkspace'))
WHERE json_extract(extra, '$.customWorkspace') IS NOT NULL
  AND json_extract(extra, '$.custom_workspace') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.defaultFiles'), '$.default_files', json_extract(extra, '$.defaultFiles'))
WHERE json_extract(extra, '$.defaultFiles') IS NOT NULL
  AND json_extract(extra, '$.default_files') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.acpSessionConversationId'), '$.acp_session_conversation_id', json_extract(extra, '$.acpSessionConversationId'))
WHERE json_extract(extra, '$.acpSessionConversationId') IS NOT NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.acpSessionId'), '$.acp_session_id', json_extract(extra, '$.acpSessionId'))
WHERE json_extract(extra, '$.acpSessionId') IS NOT NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.acpSessionUpdatedAt'), '$.acp_session_updated_at', json_extract(extra, '$.acpSessionUpdatedAt'))
WHERE json_extract(extra, '$.acpSessionUpdatedAt') IS NOT NULL;

UPDATE conversations
SET extra = json_set(extra, '$.team_id', json_extract(extra, '$.teamId'))
WHERE json_extract(extra, '$.teamId') IS NOT NULL
  AND json_extract(extra, '$.team_id') IS NULL;

UPDATE conversations
SET extra = json_set(json_remove(extra, '$.customAgentId'), '$.custom_agent_id', json_extract(extra, '$.customAgentId'))
WHERE json_extract(extra, '$.customAgentId') IS NOT NULL
  AND json_extract(extra, '$.custom_agent_id') IS NULL;

UPDATE conversations
SET extra = json_remove(extra, '$.cachedConfigOptions', '$.loadedSkills', '$.lastContextLimit', '$.lastTokenUsage')
WHERE json_extract(extra, '$.cachedConfigOptions') IS NOT NULL
   OR json_extract(extra, '$.loadedSkills') IS NOT NULL;

UPDATE conversations
SET extra = json_set(
    json_remove(extra, '$.teamMcpStdioConfig'),
    '$.legacy_team_mcp_stdio_config', json_extract(extra, '$.teamMcpStdioConfig')
)
WHERE json_extract(extra, '$.teamMcpStdioConfig') IS NOT NULL
  AND json_extract(extra, '$.legacy_team_mcp_stdio_config') IS NULL;

UPDATE conversations
SET model = json_object(
    'provider_id', json_extract(model, '$.id'),
    'model',       json_extract(model, '$.useModel'),
    'use_model',   NULL
)
WHERE model IS NOT NULL
  AND json_valid(model)
  AND json_type(model, '$.model') = 'array'
  AND json_extract(model, '$.useModel') IS NOT NULL;

UPDATE teams
SET agents = (
    SELECT json_group_array(
        json_object(
            'slot_id',           json_extract(value, '$.slotId'),
            'name',              COALESCE(json_extract(value, '$.agentName'), json_extract(value, '$.name'), ''),
            'role',              CASE
                                   WHEN COALESCE(json_extract(value, '$.role'), '') IN ('lead', 'leader') THEN 'lead'
                                   ELSE 'teammate'
                                 END,
            'conversation_id',   COALESCE(json_extract(value, '$.conversationId'), json_extract(value, '$.conversation_id'), ''),
            'backend',           COALESCE(json_extract(value, '$.agentType'), json_extract(value, '$.backend'), ''),
            'model',             COALESCE(json_extract(value, '$.model'), ''),
            'status',            COALESCE(json_extract(value, '$.status'), 'pending'),
            'conversation_type', COALESCE(json_extract(value, '$.conversationType'), json_extract(value, '$.conversation_type'), ''),
            'cli_path',          json_extract(value, '$.cliPath'),
            'custom_agent_id',   json_extract(value, '$.customAgentId')
        )
    )
    FROM json_each(teams.agents)
),
agents_version = '1.0.1'
WHERE agents_version = '1.0.0'
  AND json_valid(agents)
  AND json_array_length(agents) > 0
  AND json_extract(agents, '$[0].slotId') IS NOT NULL;

UPDATE teams
SET agents_version = '1.0.1'
WHERE agents_version = '1.0.0'
  AND (agents = '[]' OR json_array_length(agents) = 0);
`;

/**
 * acp_session backfill for imported ACP conversations (mirrors 002 Part E).
 * Dreamcore migration 013 dropped `agent_backend` and made `agent_id` the only
 * agent reference, so the post-013 variant resolves the catalog row the same
 * way 013 did for historical rows.
 */
const ACP_SESSION_BACKFILL_PRE013_SQL = `
INSERT OR IGNORE INTO acp_session (
    conversation_id,
    agent_backend,
    agent_source,
    agent_id,
    session_id,
    session_status,
    session_config
)
SELECT
    c.id,
    COALESCE(json_extract(c.extra, '$.backend'), ''),
    'builtin',
    '',
    json_extract(c.extra, '$.acp_session_id'),
    'idle',
    '{}'
FROM conversations c
WHERE c.type = 'acp'
  AND json_extract(c.extra, '$.acp_session_id') IS NOT NULL
  AND c.id NOT IN (SELECT conversation_id FROM acp_session);
`;

const ACP_SESSION_BACKFILL_POST013_SQL = `
INSERT OR IGNORE INTO acp_session (
    conversation_id,
    agent_source,
    agent_id,
    session_id,
    session_status,
    session_config
)
SELECT
    c.id,
    'builtin',
    COALESCE(
        (
            SELECT am.id
            FROM agent_metadata am
            WHERE am.id = json_extract(c.extra, '$.backend')
               OR am.backend = json_extract(c.extra, '$.backend')
               OR am.agent_type = json_extract(c.extra, '$.backend')
            ORDER BY
                CASE am.agent_source WHEN 'builtin' THEN 0 ELSE 1 END,
                am.sort_order,
                am.id
            LIMIT 1
        ),
        ''
    ),
    json_extract(c.extra, '$.acp_session_id'),
    'idle',
    '{}'
FROM conversations c
WHERE c.type = 'acp'
  AND json_extract(c.extra, '$.acp_session_id') IS NOT NULL
  AND c.id NOT IN (SELECT conversation_id FROM acp_session);
`;

function tableExists(db: ISqliteDriver, table: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
}

function ensureSystemUser(db: ISqliteDriver): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username, email, password_hash, avatar_path, created_at, updated_at, last_login, jwt_secret)
     VALUES (?, ?, NULL, '', NULL, ?, ?, NULL, NULL)`
  ).run(DEFAULT_USER_ID, DEFAULT_USER_ID, now, now);
}

/**
 * Bring a freshly-created (or pre-existing) Electron-managed catalog to the
 * v26 handoff baseline — same sequence as runLegacyDatabaseMigrations, but
 * usable on a database file we may have just created.
 */
function ensureHandoffBaseline(db: ISqliteDriver): void {
  initSchema(db);
  const currentVersion = getDatabaseVersion(db);
  if (currentVersion < CURRENT_DB_VERSION) {
    runMigrations(db, currentVersion, CURRENT_DB_VERSION);
    setDatabaseVersion(db, CURRENT_DB_VERSION);
  }
  repairLegacyHandoffSchema(db);
}

/**
 * Import conversations/messages/teams/mailbox/cron_jobs from a 1ONE
 * ClaudeCode (`1one.db`) catalog into the dream catalog.
 *
 * Target selection follows the backend's legacy-copy semantics
 * (`maybe_copy_legacy_database` copies `dream.db` → `dream-backend.db` only
 * when the backend catalog does not exist yet):
 * - backend catalog exists  → import into `dream-backend.db` directly and
 *   normalize here (its one-shot 002 migration already ran);
 * - fresh install           → import into `dream.db`; the backend picks it
 *   up through the regular legacy handoff on first boot.
 *
 * The source database is never opened directly — a temp copy is attached
 * read-only, so the 1one install stays untouched (rollback = reinstall 1one).
 */
export async function importOneLegacyDb(sourceDbPath: string, dataDir = getDataPath()): Promise<OneDbImportResult> {
  // Must resolve exactly the way the backend does (`data_paths::backend_db_path`):
  // a pre-rebrand install still keeps its catalog under the old name, and probing
  // only the current one would read "no backend catalog yet" and import into the
  // legacy handoff DB that the backend has long since stopped reading.
  const backendDbPath = resolveWithLegacyName(dataDir, 'one-backend.db', 'aionui-backend.db');
  const legacyDbPath = path.join(dataDir, 'aionui.db');
  const targetIsBackend = existsSync(backendDbPath);
  const targetDb = targetIsBackend ? backendDbPath : legacyDbPath;

  let backupPath: string | null = null;
  if (existsSync(targetDb)) {
    backupPath = `${targetDb}.pre-one-import.bak`;
    copyFileSync(targetDb, backupPath);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'one-import-'));
  const sourceCopy = path.join(tempDir, '1one.db');
  copyFileSync(sourceDbPath, sourceCopy);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(sourceDbPath + suffix)) {
      copyFileSync(sourceDbPath + suffix, sourceCopy + suffix);
    }
  }

  const { BetterSqlite3Driver } = await import('@process/services/database/drivers/BetterSqlite3Driver');
  const db = new BetterSqlite3Driver(targetDb);
  const counts: Record<string, number> = {};

  try {
    db.pragma('busy_timeout = 5000');
    // One-shot maintenance pass; FK graphs differ between the Electron and
    // backend catalogs, so constraint checking is deferred entirely.
    db.pragma('foreign_keys = OFF');

    if (!targetIsBackend) {
      ensureHandoffBaseline(db);
    }
    ensureSystemUser(db);

    db.prepare('ATTACH DATABASE ? AS one').run(sourceCopy);

    const importAll = db.transaction(() => {
      counts.conversations = db
        .prepare(
          `INSERT OR IGNORE INTO main.conversations
             (id, user_id, name, type, extra, model, status, source, channel_chat_id, pinned, pinned_at, created_at, updated_at)
           SELECT
             c.id,
             '${DEFAULT_USER_ID}',
             c.name,
             c.type,
             COALESCE(c.extra, '{}'),
             c.model,
             COALESCE(c.status, 'pending'),
             CASE
               WHEN c.source = '1one' THEN 'aionui'
               WHEN c.source IN ('telegram', 'lark', 'dingtalk', 'weixin') THEN c.source
               ELSE NULL
             END,
             c.channel_chat_id,
             CASE WHEN json_extract(c.extra, '$.pinned') = 1 THEN 1 ELSE 0 END,
             json_extract(c.extra, '$.pinnedAt'),
             c.created_at,
             c.updated_at
           FROM one.conversations c`
        )
        .run().changes;

      counts.messages = db
        .prepare(
          `INSERT OR IGNORE INTO main.messages
             (id, conversation_id, msg_id, type, content, position, status, hidden, created_at)
           SELECT
             m.id, m.conversation_id, m.msg_id, m.type,
             COALESCE(m.content, '{}'),
             m.position, m.status,
             COALESCE(m.hidden, 0),
             m.created_at
           FROM one.messages m
           WHERE m.conversation_id IN (SELECT id FROM one.conversations)`
        )
        .run().changes;

      counts.teams = db
        .prepare(
          `INSERT OR IGNORE INTO main.teams
             (id, user_id, name, workspace, workspace_mode, agents, lead_agent_id, session_mode, agents_version, created_at, updated_at)
           SELECT
             t.id,
             '${DEFAULT_USER_ID}',
             t.name,
             COALESCE(t.workspace, ''),
             COALESCE(t.workspace_mode, 'shared'),
             COALESCE(t.agents, '[]'),
             CASE WHEN t.lead_agent_id = '' THEN NULL ELSE t.lead_agent_id END,
             NULL,
             '1.0.0',
             t.created_at,
             t.updated_at
           FROM one.teams t`
        )
        .run().changes;

      counts.mailbox = db
        .prepare(
          `INSERT OR IGNORE INTO main.mailbox
             (id, team_id, to_agent_id, from_agent_id, type, content, summary, read, created_at)
           SELECT
             b.id, b.team_id, b.to_agent_id, b.from_agent_id,
             CASE WHEN b.type IN ('message', 'idle_notification', 'shutdown_request') THEN b.type ELSE 'message' END,
             b.content, b.summary,
             COALESCE(b.read, 0),
             b.created_at
           FROM one.mailbox b`
        )
        .run().changes;

      // Dreamcore migration 013 moved cron jobs to assistant-first execution
      // and dropped `agent_type`. On the fresh path the column still exists
      // and 013 will attempt the assistant mapping itself (disabling jobs it
      // cannot map). On the backend path 013 already ran, so 1one jobs are
      // imported disabled — their agent identity has no direct counterpart
      // and needs a manual re-pick in the cron UI.
      const cronHasAgentType = Boolean(
        db.prepare("SELECT name FROM pragma_table_info('cron_jobs') WHERE name = 'agent_type'").get()
      );
      const cronInsertSql = cronHasAgentType
        ? `INSERT OR IGNORE INTO main.cron_jobs
             (id, name, enabled, schedule_kind, schedule_value, schedule_tz, schedule_description, payload_message,
              execution_mode, agent_config, conversation_id, conversation_title, agent_type, created_by,
              created_at, updated_at, next_run_at, last_run_at, last_status, last_error, run_count, retry_count, max_retries)
           SELECT
             j.id, j.name,
             COALESCE(j.enabled, 1),
             j.schedule_kind, j.schedule_value, j.schedule_tz, j.schedule_description, j.payload_message,
             COALESCE(j.execution_mode, 'existing'),
             j.agent_config, j.conversation_id, j.conversation_title, j.agent_type, j.created_by,
             j.created_at, j.updated_at, j.next_run_at, j.last_run_at,
             CASE WHEN j.last_status IN ('ok', 'error', 'skipped', 'missed') THEN j.last_status ELSE NULL END,
             j.last_error,
             COALESCE(j.run_count, 0),
             COALESCE(j.retry_count, 0),
             COALESCE(j.max_retries, 3)
           FROM one.cron_jobs j
           WHERE j.schedule_kind IN ('at', 'every', 'cron')
             AND j.created_by IN ('user', 'agent')`
        : `INSERT OR IGNORE INTO main.cron_jobs
             (id, name, enabled, schedule_kind, schedule_value, schedule_tz, schedule_description, payload_message,
              execution_mode, agent_config, conversation_id, conversation_title, created_by,
              created_at, updated_at, next_run_at, last_run_at, last_status, last_error, run_count, retry_count, max_retries)
           SELECT
             j.id, j.name,
             0,
             j.schedule_kind, j.schedule_value, j.schedule_tz, j.schedule_description, j.payload_message,
             COALESCE(j.execution_mode, 'existing'),
             j.agent_config, j.conversation_id, j.conversation_title, j.created_by,
             j.created_at, j.updated_at, j.next_run_at, j.last_run_at,
             'error',
             'imported from 1ONE ClaudeCode; re-select the assistant and re-enable',
             COALESCE(j.run_count, 0),
             COALESCE(j.retry_count, 0),
             COALESCE(j.max_retries, 3)
           FROM one.cron_jobs j
           WHERE j.schedule_kind IN ('at', 'every', 'cron')
             AND j.created_by IN ('user', 'agent')`;
      counts.cron_jobs = db.prepare(cronInsertSql).run().changes;

      db.exec(ONE_EXTRA_NORMALIZE_SQL);
      db.exec(AIONCORE_002_NORMALIZE_SQL);
      if (tableExists(db, 'acp_session')) {
        const acpSessionPre013 = Boolean(
          db.prepare("SELECT name FROM pragma_table_info('acp_session') WHERE name = 'agent_backend'").get()
        );
        db.exec(acpSessionPre013 ? ACP_SESSION_BACKFILL_PRE013_SQL : ACP_SESSION_BACKFILL_POST013_SQL);
      }
    });
    importAll();

    db.exec('DETACH DATABASE one');
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return {
    targetDb,
    backupPath,
    counts,
    skippedTables: [...ONE_SKIPPED_TABLES],
  };
}
