/**
 * Delete a personal digital employee and disable its schedule.
 *
 * The one-employee crate owns the schedule, so disabling it here is enough —
 * no separate cron-job cleanup is needed (unlike the 1one reference, which
 * stored schedules in the upstream cron table and had to unlink them).
 */

import { ipcBridge } from '@/common';

export async function deletePersonalDigitalEmployee(input: { agentId: string }): Promise<void> {
  // Best-effort disable the schedule before delete; ignore errors when the
  // agent had no schedule or was already disabled.
  try {
    await ipcBridge.personalAgent.setSchedule.invoke({
      agentId: input.agentId,
      schedule: { enabled: false },
    });
  } catch (error) {
    console.warn('[deletePersonalDigitalEmployee] failed to disable schedule', error);
  }
  await ipcBridge.personalAgent.remove.invoke({ agentId: input.agentId });
}
