/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The public projection of a media job — the single shape every consumer sees.
 *
 * There are three consumers and they must not drift apart: the MCP thin shell
 * (over TCP), the renderer (over IPC), and any future surface (a job history
 * page, the WebUI). Before this file existed the TCP frame was built by a local
 * helper in the job service, so adding a second consumer would have meant a
 * second, silently diverging shape.
 *
 * Two rules hold this contract together:
 *
 * 1. **Paths only, never bytes** (design rule D6). A media job's payload is
 *    files on disk; every channel carries the path and lets the consumer fetch
 *    the bytes over a medium built for them (`one-media://` for the renderer).
 * 2. **Additive evolution.** Consumers must tolerate unknown fields and absent
 *    optional ones, so a new field is never a breaking change. `origin` exists
 *    precisely so attribution can grow without reshaping anything.
 *
 * Renderer-safe: no Node.js imports.
 */

import type { MediaGenParams, MediaKind, MediaProgressUpdate } from './types';

export type MediaJobStatus =
  | 'pending'
  | 'submitted'
  | 'polling'
  | 'downloading'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/** Statuses that will never change again without a new job. */
export const TERMINAL_STATUSES: readonly MediaJobStatus[] = ['done', 'failed', 'cancelled', 'timeout'];

export const isTerminalStatus = (status: MediaJobStatus): boolean => TERMINAL_STATUSES.includes(status);

/** Statuses where the job is still doing work and a cancel is meaningful. */
export const isActiveStatus = (status: MediaJobStatus): boolean => !isTerminalStatus(status);

/**
 * Where a job came from — an open, additive record rather than a single id.
 *
 * `workspaceDir` is the only attribution available end to end today: an MCP
 * tool call reaches the main process with no caller identity (the stdio server
 * is configured once, globally, and the MCP protocol carries no conversation),
 * while `workspace_dir` is already a parameter of every media tool.
 *
 * Attribution is therefore resolved by the renderer, which is the layer that
 * actually knows which conversation maps to which workspace. That also keeps
 * the job service free of any notion of conversations, so it stays usable from
 * headless contexts (scheduled tasks, digital employees).
 *
 * `conversationId` / `agentSessionId` are declared now and filled in if a
 * future backend change makes caller identity available — a field gaining a
 * value is not a contract change, which is the whole point of shaping it this
 * way rather than adding a bare `conversationId` column later.
 */
export type MediaJobOrigin = {
  workspaceDir: string;
  conversationId?: string;
  agentSessionId?: string;
};

/** An asset reference. Never carries bytes — see rule D6 above. */
export type MediaJobAssetView = {
  kind: MediaKind;
  filePath: string;
  relativePath: string;
  mimeType: string;
  durationSeconds?: number;
  coverFramePath?: string;
};

export type MediaJobView = {
  jobId: string;
  kind: MediaKind;
  status: MediaJobStatus;
  model: string;
  /**
   * What was asked for. Media requests never become conversation messages, so
   * without this a card can only name its model — and two failed attempts on the
   * same model are indistinguishable from each other.
   */
  prompt?: string;
  /**
   * The parameters the job ran with, so "regenerate" reproduces the request
   * rather than a default-shaped approximation of it.
   */
  params?: MediaGenParams;
  /** Reference-image paths, for the same reason. Paths only — rule D6. */
  inputUris?: string[];
  /**
   * The provider the job ran against.
   *
   * Present so a consumer can look up the user's declared price for this exact
   * model rather than matching by name: two providers can carry the same model
   * name with different prices, and a cost figure attributed to the wrong one
   * is worse than no figure.
   */
  providerId?: string;
  origin: MediaJobOrigin;
  progress?: MediaProgressUpdate;
  assets?: MediaJobAssetView[];
  error?: string;
  /**
   * Parameters this model does not support, clipped before the request went
   * out. Travels with the job so the MCP shell can tell the agent what it did
   * not get — a success frame that silently drops `n: 4` to one image leaves
   * the agent to guess, and it will report whatever it guessed to the user.
   */
  droppedParams?: string[];
  /**
   * The model's own text reply when the job produced no assets (Form B can
   * legitimately answer with only text — e.g. an "Analyze image: ..." prompt
   * against a model that actually supports vision returns a description, not
   * a picture). Without this the caller sees a bare "done, 0 assets" and has
   * no way to know the model *did* respond — it just didn't draw anything.
   */
  resultText?: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Does this job belong to the given workspace?
 *
 * Comparison is case-insensitive with separators normalized: the same directory
 * legitimately arrives spelled differently (a tool passes `D:/ws`, the app
 * stores `D:\ws`), and a false negative here means a user watches a job that
 * never appears in the surface they are looking at.
 */
export const normalizeWorkspaceKey = (dir: string): string =>
  (dir || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();

export const jobBelongsToWorkspace = (job: MediaJobView, workspaceDir: string): boolean =>
  normalizeWorkspaceKey(job.origin?.workspaceDir || '') === normalizeWorkspaceKey(workspaceDir);

/**
 * Does this job belong to the given conversation?
 *
 * A job started from the send box carries its conversation, so it shows only
 * there. One started by an agent through MCP carries none — the tool call
 * reaches the engine without caller identity — and falls back to the workspace,
 * which is the best signal that path has. Two conversations sharing a workspace
 * therefore see each other's agent-started jobs; that resolves itself the day a
 * conversation id can travel with an MCP call, with no change here.
 */
export const jobBelongsToConversation = (
  job: MediaJobView,
  conversationId: string | undefined,
  workspaceDir: string | undefined
): boolean => {
  if (job.origin?.conversationId) return job.origin.conversationId === conversationId;
  return !!workspaceDir && jobBelongsToWorkspace(job, workspaceDir);
};
