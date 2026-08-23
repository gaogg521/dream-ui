/**
 * Digital employee types for the one-employee crate.
 *
 * Mirrors the Rust `PersonalAgentRow` / `EmployeeRunRow` shapes in
 * `crates/one-employee/src/models.rs` of the AionCore fork. The backend
 * serializes with camelCase keys (serde rename_all = camelCase), so the
 * TypeScript types use camelCase directly — no mapping layer needed.
 */

export type DigitalEmployeeRunStatus = 'running' | 'success' | 'failed';

export type DigitalEmployeeRunRecord = {
  id: string;
  agentId: string;
  ownerUserId: string;
  tenantId: string;
  teamId?: string | null;
  slotId?: string | null;
  conversationId: string;
  turnId?: string | null;
  status: DigitalEmployeeRunStatus;
  summary?: string | null;
  error?: string | null;
  triggerSource: 'manual' | 'cron';
  startedAt: number;
  finishedAt?: number | null;
};

export type CronScheduleDto =
  | { kind: 'at'; at_ms: number; description?: string }
  | { kind: 'every'; every_ms: number; description?: string }
  | { kind: 'cron'; expr: string; tz?: string; description?: string };

export type PersonalAgentAutomationConfig = {
  skillIds?: string[];
  /** @deprecated Never written. Use the first-class `modelId` field instead. */
  preferredModelId?: string;
  /** @deprecated Never written. Use the first-class `model` field instead. */
  providerModelKey?: string;
  instructions?: string;
  [key: string]: unknown;
};

/**
 * Provider + model pair for aionrs employees. Note the snake_case keys: the
 * Rust `ProviderWithModel` carries no `rename_all`, so it stays snake_case even
 * inside the otherwise camelCase employee payloads — the same shape already
 * used for cron jobs.
 */
export type PersonalAgentModel = {
  provider_id: string;
  model: string;
  use_model?: string | null;
};

/**
 * Persona + backend + model binding shared by the create and update payloads.
 *
 * - `assistantId` — the expert/persona this employee runs as.
 * - `agentIdOverride` — `agent_metadata.id` to run that persona under, set only
 *   when the user manually overrode the backend the persona implies. This is
 *   the only channel that works: once a persona is attached, the conversation's
 *   agent type is derived from the assistant snapshot.
 * - `modelId` — plain model id, for ACP backends.
 * - `model` — provider + model, for aionrs only. The backend rejects a model on
 *   any other agent type.
 */
export type PersonalAgentBinding = {
  assistantId?: string;
  agentIdOverride?: string;
  modelId?: string;
  model?: PersonalAgentModel;
};

export type PersonalAgent = {
  id: string;
  ownerUserId: string;
  tenantId: string;
  name: string;
  description?: string | null;
  /** The effective backend ('claude', 'aionrs', …). */
  agentType: string;
  /** @deprecated Legacy column, read only as a fallback source for `assistantId`. */
  customAgentId?: string | null;
  cliPath?: string | null;
  assistantId?: string | null;
  agentIdOverride?: string | null;
  modelId?: string | null;
  model?: PersonalAgentModel | null;
  automationConfig: PersonalAgentAutomationConfig;
  schedule?: CronScheduleDto | null;
  scheduleEnabled: boolean;
  nextRunAt?: number | null;
  /** 'private' (owner-only) or 'shared' (usable by same-tenant members). */
  visibility: 'private' | 'shared';
  createdAt: number;
  updatedAt: number;
};

export type CreatePersonalAgentInput = PersonalAgentBinding & {
  name: string;
  description?: string;
  agentType: string;
  customAgentId?: string;
  cliPath?: string;
  automationConfig?: PersonalAgentAutomationConfig;
};

/**
 * Omitted field → left unchanged. For the nullable binding fields an explicit
 * empty string clears the column, so a persona or model can be detached.
 */
export type UpdatePersonalAgentInput = PersonalAgentBinding & {
  name?: string;
  description?: string;
  agentType?: string;
  automationConfig?: PersonalAgentAutomationConfig;
};

export type SetScheduleInput = {
  schedule?: CronScheduleDto;
  enabled?: boolean;
};

export type RunNowResult = {
  runId: string;
  conversationId: string;
};

export type RunTeamParams = {
  teamId: string;
  slotId: string;
};
