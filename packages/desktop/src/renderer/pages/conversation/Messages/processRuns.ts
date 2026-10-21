/**
 * Copyright 2026 One Work
 */

import type { IMessageThinking } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';

/** A group of tool calls, as the message list builds it. */
export type ToolSummaryItem = {
  type: 'tool_summary';
  id: string;
  messages: ToolMessage[];
  sourceMessageIds: string[];
  created_at: number;
};

/** One step of a process run: a thought or a group of tool calls. */
export type ProcessStep = IMessageThinking | ToolSummaryItem;

export type ProcessRunItem = {
  type: 'process_run';
  id: string;
  steps: ProcessStep[];
  sourceMessageIds: string[];
  created_at: number;
};

const isStep = (item: unknown): item is ProcessStep => {
  if (!item || typeof item !== 'object') return false;
  const type = (item as { type?: string }).type;
  return type === 'tool_summary' || type === 'thinking';
};

/**
 * Fold every run of consecutive thoughts and tool groups into one `process_run`.
 *
 * Between two pieces of the agent's own text the transcript used to read "thought
 * complete / View Steps / thought complete / View Steps ..." — a column of identical
 * grey rows that buries the text the person came to read. Anything else (text, file
 * changes, questions, permissions) ends a run, so the narration stays in the open and
 * only the machinery in between is folded. A lone step is left as it was.
 */
export const foldProcessRuns = <T>(items: T[]): Array<T | ProcessRunItem> => {
  const out: Array<T | ProcessRunItem> = [];
  let run: ProcessStep[] = [];

  const flush = () => {
    if (run.length >= 2) {
      out.push({
        type: 'process_run',
        id: `process-run-${run[0].id}`,
        steps: run,
        sourceMessageIds: run.flatMap((step) => (step.type === 'tool_summary' ? step.sourceMessageIds : [step.id])),
        created_at: run[0].created_at ?? 0,
      });
    } else {
      out.push(...(run as unknown as T[]));
    }
    run = [];
  };

  for (const item of items) {
    if (isStep(item)) {
      run.push(item);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  return out;
};
