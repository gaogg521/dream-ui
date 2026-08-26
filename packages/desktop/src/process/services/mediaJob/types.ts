/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Media job types. See docs/specs/media-generation/architecture.zh-CN.md §4.3.
 */

import type { MediaAsset, MediaGenParams, MediaKind, MediaProgressUpdate } from '@/common/media/types';
import { isTerminalStatus, type MediaJobOrigin, type MediaJobStatus, type MediaJobView } from '@/common/media/jobView';

// Status is defined with the public job view so the service, the MCP shell and
// the renderer cannot drift apart. Re-exported here because this module is the
// job service's own vocabulary.
export { TERMINAL_STATUSES } from '@/common/media/jobView';
export type { MediaJobOrigin, MediaJobStatus };

export const isTerminal = (status: MediaJobStatus): boolean => isTerminalStatus(status);

/**
 * Persisted job record.
 *
 * Deliberately holds NO api_key: credentials are re-resolved from the provider
 * store at execution time, so a leaked jobs file cannot leak keys and a rotated
 * key is picked up by a recovered job.
 */
export type MediaJobRecord = {
  id: string;
  kind: MediaKind;
  status: MediaJobStatus;
  prompt: string;
  params: MediaGenParams;
  inputUris: string[];
  /** Provider the job was created against; api_key is resolved fresh each run. */
  providerId: string;
  model: string;
  /** Catalog spec id, for diagnostics and to detect catalog drift on recovery. */
  specId?: string;
  /** Remote task id (Form C). Its presence is what makes a job recoverable. */
  remoteTaskId?: string;
  workspaceDir: string;
  /**
   * Attribution, persisted so a job recovered after a restart still surfaces in
   * the right place. Optional on the record because jobs written before this
   * field existed are still readable; `toMediaJobView` fills it from
   * `workspaceDir` when absent.
   */
  origin?: MediaJobOrigin;
  createdAt: number;
  updatedAt: number;
  assets?: MediaAsset[];
  error?: string;
  /**
   * Parameters the caller asked for that this model does not support, so they
   * were clipped before the request went out.
   *
   * Carried on the job rather than only in the execution result because the
   * caller that most needs to know is an agent on the other side of the MCP
   * socket. Without it the agent sees a plain success and cannot tell that, say,
   * its `n: 4` became one image — observed live, where it guessed (correctly
   * that time) and reported "4 images generated" to the user regardless.
   */
  droppedParams?: string[];
  /** See `MediaJobView.resultText` — the model's text reply when it produced no assets. */
  resultText?: string;
  progress?: MediaProgressUpdate;
};

export type MediaJobSnapshot = Readonly<MediaJobRecord>;

/** Everything needed to create a job, before an id or timestamps exist. */
export type MediaJobRequest = {
  kind: MediaKind;
  prompt: string;
  params: MediaGenParams;
  inputUris: string[];
  providerId: string;
  model: string;
  specId?: string;
  workspaceDir: string;
  origin?: MediaJobOrigin;
};

/**
 * Project a stored job into the public view shared by every consumer.
 *
 * Kept next to the record (not in the TCP service) because the IPC broadcast
 * and the TCP frame must be the same shape — that was the drift risk when the
 * projection lived inside the socket handler.
 */
export const toMediaJobView = (job: MediaJobSnapshot): MediaJobView => ({
  jobId: job.id,
  kind: job.kind,
  status: job.status,
  model: job.model,
  prompt: job.prompt,
  params: job.params,
  inputUris: job.inputUris,
  providerId: job.providerId,
  // Older records predate `origin`; workspaceDir has always been present and is
  // exactly what the field was extracted from.
  origin: job.origin ?? { workspaceDir: job.workspaceDir },
  progress: job.progress,
  // Paths only — media bytes never cross a message channel (design rule D6).
  assets: job.assets?.map((asset) => ({
    kind: asset.kind,
    filePath: asset.filePath,
    relativePath: asset.relativePath,
    mimeType: asset.mimeType,
    durationSeconds: asset.durationSeconds,
    coverFramePath: asset.coverFramePath,
  })),
  error: job.error,
  droppedParams: job.droppedParams,
  resultText: job.resultText,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});
