/**
 * Open a conversation with a digital employee.
 *
 * The backend creates the conversation and the run row that binds it to the
 * employee — that row, not anything the renderer puts in conversation extra,
 * is what makes the runtime load the employee's persona, bound skills and
 * connectors. Nothing is sent: an optional first message is queued the same
 * way the home composer queues one, and the conversation page delivers it.
 */

import type { NavigateFunction } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';
import { emitter } from '@/renderer/utils/emitter';

const MAX_STARTER_PROMPTS = 4;

/** Example tasks the admin wrote for this employee, trimmed and capped. */
export function resolveEmployeeStarterPrompts(agent: Pick<PersonalAgent, 'automationConfig'>): string[] {
  const raw = agent.automationConfig?.starterPrompts;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_STARTER_PROMPTS);
}

export async function startEmployeeChat(
  agentId: string,
  navigate: NavigateFunction,
  firstMessage?: string
): Promise<string> {
  const { conversationId } = await ipcBridge.personalAgent.startChat.invoke({ agentId });
  const input = firstMessage?.trim();
  if (input) {
    // The conversation's platform (dream engine vs an ACP CLI) follows the
    // employee's backend, and each platform's send box reads its own key. Only
    // the send box that mounts consumes its key, so queueing under both is
    // exact rather than a guess about which backend this employee resolves to.
    const queued = JSON.stringify({ input });
    sessionStorage.setItem(`one_initial_message_${conversationId}`, queued);
    sessionStorage.setItem(`acp_initial_message_${conversationId}`, queued);
  }
  emitter.emit('chat.history.refresh');
  await navigate(`/conversation/${conversationId}`);
  return conversationId;
}
