/**
 * Copyright 2026 One Work
 */

import { useEffect, useState } from 'react';
import { ipcBridge } from '@/common';

/** A command line is shown in one status row; the full text lives in the approval queue. */
const COMMAND_PREVIEW_CHARS = 80;

const previewCommand = (command: string): string => {
  const flat = command.replace(/\s+/g, ' ').trim();
  return flat.length > COMMAND_PREVIEW_CHARS ? `${flat.slice(0, COMMAND_PREVIEW_CHARS)}…` : flat;
};

export type TerminalApprovalWait = {
  taskId: string;
  command: string;
  startedAtMs: number;
  expiresAtMs: number;
};

/**
 * Whether this conversation is currently held on a company administrator's
 * approval of a terminal command.
 *
 * The backend holds the call for up to ten minutes with nothing else telling
 * the member why; without this the tool card just keeps spinning. Events for
 * other conversations are ignored, and a resolved event only clears the wait it
 * belongs to, so a late "resolved" for an older task cannot hide a newer one.
 */
export function useTerminalApprovalWait(conversationId: string): TerminalApprovalWait | null {
  const [wait, setWait] = useState<TerminalApprovalWait | null>(null);

  useEffect(() => {
    setWait(null);
    const offPending = ipcBridge.conversation.approvalPending.on((event) => {
      if (event.conversationId !== conversationId) return;
      setWait({
        taskId: event.taskId,
        command: previewCommand(event.command),
        startedAtMs: event.startedAtMs,
        expiresAtMs: event.expiresAtMs,
      });
    });
    const offResolved = ipcBridge.conversation.approvalResolved.on((event) => {
      if (event.conversationId !== conversationId) return;
      setWait((current) => (current && current.taskId === event.taskId ? null : current));
    });
    return () => {
      offPending();
      offResolved();
    };
  }, [conversationId]);

  return wait;
}
