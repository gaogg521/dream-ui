/**
 * Copyright 2026 One Work
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import { isInstalledGeneratedCliAssistant, selectableAssistants } from '@/renderer/utils/model/assistantSelection';

/** Backends shown as pills on the welcome page; the rest sit behind "more". */
export const MAX_VISIBLE_BACKEND_PILLS = 5;

export type BackendPills = { visible: Assistant[]; overflow: Assistant[] };

/**
 * Split the installed CLI backends into the pills shown and the ones behind "more".
 *
 * Order is the person's own priority (the drag order of the enabled list in the assistants
 * page), falling back to the legacy order. Backends that cannot run right now go after the
 * ones that can, so the visible pills are the ones worth clicking. The selected backend is
 * always visible: if it would have landed in the overflow it takes the last visible slot.
 */
export const splitBackendPills = (
  assistants: Assistant[],
  preferredOrder: readonly string[] | undefined,
  selectedAgentId: string | null,
  max: number = MAX_VISIBLE_BACKEND_PILLS
): BackendPills => {
  const ordered = selectableAssistants(
    assistants.filter((assistant) => assistant.source === 'generated').filter(isInstalledGeneratedCliAssistant),
    preferredOrder
  );
  const usable = ordered.filter((assistant) => assistant.agent_status === 'online');
  const unusable = ordered.filter((assistant) => assistant.agent_status !== 'online');
  const all = [...usable, ...unusable];

  const visible = all.slice(0, max);
  const overflow = all.slice(max);

  const selectedIndex = overflow.findIndex((assistant) => assistant.agent_id === selectedAgentId);
  if (selectedIndex !== -1 && visible.length > 0) {
    const [selected] = overflow.splice(selectedIndex, 1);
    const displaced = visible.pop();
    visible.push(selected);
    if (displaced) overflow.unshift(displaced);
  }
  return { visible, overflow };
};
