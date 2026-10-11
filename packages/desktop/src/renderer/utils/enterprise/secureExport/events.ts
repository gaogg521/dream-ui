/**
 * Copyright 2026 One Work
 */

/**
 * Export record, reported to the company server.
 *
 * Same contract as content-inspection findings: buffer locally, send now if
 * possible, retry on the five-minute sync loop otherwise. Event ids are
 * minted here, so a retried upload never double-counts.
 */

import { ipcBridge } from '@/common';
import type { SecureExportEventInput } from '@/common/adapter/ipcBridge';

/** Where an export came from; the server only accepts these. */
export type ExportKind =
  | 'conversation_markdown'
  | 'conversation_command'
  | 'history_batch'
  | 'team'
  | 'preview_download'
  | 'tool_download'
  | 'media'
  | 'backup'
  | 'clipboard';

const QUEUE_KEY = 'one.secureExport.events.v1';
const MAX_QUEUED = 1000;
const BATCH_SIZE = 200;

let flushing: Promise<void> | null = null;

function readQueue(): SecureExportEventInput[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as SecureExportEventInput[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(events: SecureExportEventInput[]): void {
  try {
    // Oldest first out when the server has been unreachable for very long.
    localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUED)));
  } catch {
    // Unavailable storage: the event is lost, the export is not.
  }
}

export function newEventId(): string {
  return `ev-${crypto.randomUUID()}`;
}

/** Queue an event and try to deliver it right away. */
export function recordExportEvent(
  event: Omit<SecureExportEventInput, 'eventId' | 'clientTs'> & { clientTs?: number }
): void {
  const full: SecureExportEventInput = { eventId: newEventId(), clientTs: Date.now(), ...event };
  writeQueue([...readQueue(), full]);
  void flushExportEvents();
}

/**
 * Deliver everything queued. Concurrent callers share one flush. Events the
 * server rejects as malformed are dropped rather than retried forever; any
 * other failure keeps the queue for the next attempt.
 */
export function flushExportEvents(): Promise<void> {
  if (flushing) return flushing;
  const run = drainQueue();
  flushing = run;
  // Cleared after the assignment above, never inside `drainQueue`: with an
  // empty queue the async body finishes synchronously, so a `finally` in it
  // would null the slot *before* it is assigned — leaving a settled promise
  // there for good, and every later flush returning it without sending.
  void run.finally(() => {
    if (flushing === run) flushing = null;
  });
  return run;
}

async function drainQueue(): Promise<void> {
  let queue = readQueue();
  while (queue.length > 0) {
    const batch = queue.slice(0, BATCH_SIZE);
    try {
      // oxlint-disable-next-line no-await-in-loop -- batches go out one at a time on purpose
      await ipcBridge.onePlatform.reportExportEvents.invoke({ events: batch });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status !== 400) return;
      console.warn('[secureExport] dropping export events the server rejected:', error);
    }
    const sent = new Set(batch.map((e) => e.eventId));
    queue = readQueue().filter((e) => !sent.has(e.eventId));
    writeQueue(queue);
  }
}

export function clearExportEventQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Nothing to clear.
  }
}
