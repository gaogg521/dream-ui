import { ipcBridge } from '@/common';
import { assistantRuntimeKey } from '@/common/types/agent/assistantTypes';
import { withAutoStaffingNote } from '@/renderer/pages/team/autoStaffing/systemNote';

export async function createCollaborationTeam(options: {
  name: string;
  workspace: string;
  model: string;
  assistantId?: string;
}): Promise<string> {
  const assistants = await ipcBridge.assistants.list.invoke();
  const eligible = assistants.filter(
    (assistant) =>
      assistant.enabled !== false && assistant.team_selectable !== false && assistantRuntimeKey(assistant) === 'dream'
  );
  const leader =
    eligible.find((assistant) => assistant.id === options.assistantId) ??
    eligible.find((assistant) => assistant.source === 'generated');
  if (!leader) throw new Error('No team-capable 1ONE CLI assistant');

  const team = await ipcBridge.team.create.invoke({
    user_id: 'system_default_user',
    name: options.name,
    workspace: options.workspace,
    workspace_mode: 'shared',
    agents: [{ role: 'leader', assistant_id: leader.id, assistant_name: leader.name, model: options.model }],
  });
  if (!team?.id) throw new Error('Team creation returned no ID');
  return team.id;
}

export function collaborationLeaderInput(input: string): string {
  return (
    withAutoStaffingNote(input) +
    '\n[SYSTEM NOTE: Run this as an on-demand collaboration. For simple tasks, work directly. ' +
    'For work that has independent parts, split them into distinct tasks. Use team_list_assistants to find ' +
    'the team-capable 1ONE CLI assistant and prefer it for teammates so they can reliably use the team task and messaging tools. ' +
    'You may reuse the same assistant identity under distinct teammate names. Create a separate task for each teammate ' +
    'with team_task_create and dispatch them in parallel before waiting. Ask each teammate to mark its task ' +
    'in progress, send its findings to you via team_send_message, and then mark its task completed. ' +
    'Give each teammate only the context and permissions needed for its assignment. ' +
    'Track progress and wait for teammate results before producing the final response yourself. ' +
    'If a teammate stops without reporting, request the result once or finish the missing part yourself and say so. ' +
    'Report failed or incomplete assignments and verify or reconcile conflicting results. ' +
    'Use the same language as the user.]'
  );
}
