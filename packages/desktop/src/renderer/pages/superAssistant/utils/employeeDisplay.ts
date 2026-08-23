/**
 * Display helpers for digital employees.
 *
 * The employee row stores a raw backend label ('claude', 'dream', …). Rendering
 * it verbatim is why the roster used to show a bare "dream" instead of the
 * product name — the branded name lives on the managed-agent catalog row (the
 * dream entry reads "1ONE CLI", set by migration 019), so resolve through the
 * catalog and never hardcode a label.
 */

import type { TFunction } from 'i18next';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ManagedAgent } from '@renderer/utils/model/agentTypes';
import { resolveAssistantName } from '@renderer/utils/model/assistantDisplay';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';

/**
 * Branded label for an employee's backend. Prefers the explicit backend
 * override, then the stored backend label, and only falls back to the raw
 * string when the catalog has no matching row (e.g. an agent that was
 * uninstalled since).
 */
export function resolveEmployeeBackendLabel(
  agent: Pick<PersonalAgent, 'agentType' | 'agentIdOverride'>,
  catalog: ManagedAgent[],
  localeKey = 'en-US'
): string {
  const byOverride = agent.agentIdOverride ? catalog.find((entry) => entry.id === agent.agentIdOverride) : undefined;
  const byBackend =
    byOverride ?? catalog.find((entry) => entry.backend === agent.agentType || entry.agent_type === agent.agentType);

  if (!byBackend) return agent.agentType;
  return byBackend.name_i18n?.[localeKey] || byBackend.name || agent.agentType;
}

/**
 * Display name of the expert an employee runs as, or `undefined` when it is a
 * backend-only employee (every employee created before migration 004).
 */
export function resolveEmployeeExpertName(
  agent: Pick<PersonalAgent, 'assistantId' | 'customAgentId'>,
  assistants: Assistant[],
  localeKey = 'en-US'
): string | undefined {
  const assistantId = agent.assistantId ?? agent.customAgentId;
  if (!assistantId) return undefined;
  const assistant = assistants.find((item) => item.id === assistantId);
  return assistant ? resolveAssistantName(assistant, localeKey, assistant.name) : assistantId;
}

/**
 * `one_employee_runs.error` stores a plain stringified backend error, so there
 * is no error code to branch on — match the shape `ConversationError::
 * ProviderNotFound` renders (`Provider '<id>' not found`) and swap in the
 * friendly text. Same heuristic the team adapter uses server-side.
 *
 * With the persona/model binding in place a *newly created* employee should no
 * longer produce this, but an employee whose provider was later deleted still
 * can — and the raw string tells a user nothing about what to do.
 */
const PROVIDER_NOT_FOUND_PATTERN = /^Provider '.*' not found$/;

export function resolveEmployeeRunErrorMessage(error: string, t: TFunction): string {
  if (PROVIDER_NOT_FOUND_PATTERN.test(error.trim())) {
    return t('common.superAssistant.runErrorProviderNotFound', {
      defaultValue: '该员工绑定的模型已不存在，请在「管理」里重新选择模型',
    });
  }
  return error;
}
