/**
 * Copyright 2026 One Work
 */

import { useSyncExternalStore } from 'react';

export type AskAnswer = { question: string; labels: string[] };

/**
 * How a question card ended. `expired` = the backend no longer waits for it
 * (the turn was stopped, or another client already answered).
 */
export type AskSettlement =
  | { status: 'answered'; answers: AskAnswer[] }
  | { status: 'declined' }
  | { status: 'expired' };

/**
 * Session-scoped state shared by the inline question card in the message list
 * and the question dialog docked above the composer — the same question must
 * not look pending in one place and answered in the other. Keyed by request_id,
 * which is unique per question across conversations.
 */
const settlements = new Map<string, AskSettlement>();
const minimized = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const notify = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getVersion = () => version;

export const settleAsk = (requestId: string, settlement: AskSettlement): void => {
  settlements.set(requestId, settlement);
  minimized.delete(requestId);
  notify();
};

export const getAskSettlement = (requestId: string): AskSettlement | undefined => settlements.get(requestId);

/** Collapse the dialog to a pill so the user can read the conversation first. */
export const setAskMinimized = (requestId: string, value: boolean): void => {
  if (value === minimized.has(requestId)) return;
  if (value) minimized.add(requestId);
  else minimized.delete(requestId);
  notify();
};

export const isAskMinimized = (requestId: string): boolean => minimized.has(requestId);

/** Re-render whenever any question's state changes; read values with the getters. */
export const useAskStoreVersion = (): number => useSyncExternalStore(subscribe, getVersion, getVersion);

/** Test-only: forget all state between test cases. */
export const resetAskStoreForTests = (): void => {
  settlements.clear();
  minimized.clear();
  notify();
};
