/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which media mode a conversation's send box is in, readable from outside it.
 *
 * The mode lives in `useMediaComposer`, which is instantiated inside each send
 * box — but the conversation header shows a model pill, and while a generation
 * mode is active that pill was naming the *chat* model. Two indicators on one
 * screen disagreeing about "the model" is not a cosmetic problem: the user
 * cannot tell which one their next Enter will use.
 *
 * A tiny external store rather than a context provider, because the header and
 * the send box are siblings mounted by different platform shells; wrapping both
 * would mean touching every shell for a value only two components read.
 */

import { useSyncExternalStore } from 'react';

export type MediaModeSnapshot = {
  mode: 'off' | 'image' | 'video';
  /** The media model that will run, when one is resolved. */
  model?: string;
};

const OFF: MediaModeSnapshot = { mode: 'off' };

const snapshots = new Map<string, MediaModeSnapshot>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const setMediaModeSnapshot = (conversationId: string | undefined, next: MediaModeSnapshot): void => {
  if (!conversationId) return;
  const current = snapshots.get(conversationId);
  if (current && current.mode === next.mode && current.model === next.model) return;
  if (next.mode === 'off') snapshots.delete(conversationId);
  else snapshots.set(conversationId, next);
  emit();
};

export const clearMediaModeSnapshot = (conversationId: string | undefined): void => {
  if (!conversationId || !snapshots.has(conversationId)) return;
  snapshots.delete(conversationId);
  emit();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * A request to put a conversation into a generation mode, travelling the other
 * way: from the model selector (in the header) down into the send box.
 *
 * The model picker is where a user goes to answer "what runs my next message",
 * and media models had been missing from it entirely — declaring one as a video
 * model made it vanish from the conversation, which read as the declaration
 * having done nothing. Listing them there means picking one has to be able to
 * flip the send box, and the send box's state lives in `useMediaComposer`.
 *
 * `seq` exists so the composer applies a request exactly once. Without it a
 * re-render after the mode was manually changed back would re-apply the old
 * request and fight the user for control of the send box.
 *
 * A request is a one-shot instruction, so the composer also *consumes* it once
 * applied. `seq` alone is not enough: the composer tracks the last applied one
 * in a ref, and a ref dies with the component. Leaving applied requests in this
 * map meant that remounting the send box — switching to another conversation
 * and back, or an HMR reload — reset the ref to 0 while the stale request was
 * still here, so it got applied a second time and dragged the user back into a
 * generation mode they had already left.
 */
export type MediaModeRequest = {
  seq: number;
  mode: 'off' | 'image' | 'video';
  providerId?: string;
  model?: string;
};

const requests = new Map<string, MediaModeRequest>();
let nextSeq = 0;

export const requestMediaMode = (
  conversationId: string | undefined,
  mode: 'off' | 'image' | 'video',
  target?: { providerId: string; model: string }
): void => {
  if (!conversationId) return;
  nextSeq += 1;
  requests.set(conversationId, { seq: nextSeq, mode, providerId: target?.providerId, model: target?.model });
  emit();
};

/**
 * Drop a request once it has been applied.
 *
 * Guarded by `seq` so a newer request that arrived between the effect running
 * and this call is never discarded unapplied — only the exact request the
 * caller acted on is removed.
 */
export const consumeMediaModeRequest = (conversationId: string | undefined, seq: number): void => {
  if (!conversationId) return;
  const current = requests.get(conversationId);
  if (!current || current.seq !== seq) return;
  requests.delete(conversationId);
  emit();
};

const readRequest = (conversationId: string | undefined): MediaModeRequest | undefined =>
  conversationId ? requests.get(conversationId) : undefined;

const noRequest = (): MediaModeRequest | undefined => undefined;

export const useMediaModeRequest = (conversationId: string | undefined): MediaModeRequest | undefined =>
  useSyncExternalStore(subscribe, () => readRequest(conversationId), noRequest);

/**
 * Read a conversation's media mode. Returns a stable `OFF` when inactive so
 * `useSyncExternalStore` does not see a new object on every render.
 */
export const useMediaModeSnapshot = (conversationId: string | undefined): MediaModeSnapshot =>
  useSyncExternalStore(
    subscribe,
    () => (conversationId ? (snapshots.get(conversationId) ?? OFF) : OFF),
    () => OFF
  );
