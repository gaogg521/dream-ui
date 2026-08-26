/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How a surface reaches the media job store, per host.
 *
 * The store lives in the Electron main process. The desktop renderer reaches it
 * over the Electron IPC bridge; a browser has no such bridge — its bridge
 * adapter is a WebSocket to aioncore, which has no `media.jobs.*` channel at
 * all. So in the WebUI `listJobs` resolved to nothing and `jobUpdated` never
 * fired: no cards, for any conversation, ever. That looked like "the images are
 * broken" but nothing had got as far as an image.
 *
 * Split out from `useMediaJobs` on purpose: the hook's contract (snapshot, then
 * stream, then filter) is identical on both hosts. Only the wire differs, so
 * only the wire forks.
 */

import { ipcBridge } from '@/common';
import { isWebUiBrowserMode } from '@/common/adapter/httpBridge';
import type { MediaJobView } from '@/common/media/jobView';
import { MEDIA_JOB_CANCEL_ROUTE, MEDIA_JOBS_ROUTE, MEDIA_JOBS_STREAM_ROUTE } from '@/common/media/mediaUrl';

/**
 * Start a generation.
 *
 * Reading the jobs was only half of it: in the browser the send box could show
 * a media mode and a cost estimate, then do nothing on submit, because the
 * bridge it called has no such channel there. A surface that lists results but
 * cannot produce any is not usable.
 */
export const startMediaJob = async (
  input: Record<string, unknown>
): Promise<{ job?: MediaJobView; error?: string }> => {
  if (!isWebUiBrowserMode()) return await ipcBridge.media.startJob.invoke(input as never);
  const response = await fetch(MEDIA_JOBS_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) return { error: `media job start failed: HTTP ${response.status}` };
  return (await response.json()) as { job?: MediaJobView; error?: string };
};

/** Cancel one. Stopping a paid, running generation must work on both hosts. */
export const cancelMediaJob = async (jobId: string): Promise<unknown> => {
  if (!isWebUiBrowserMode()) return await ipcBridge.media.cancelJob.invoke({ jobId });
  const response = await fetch(MEDIA_JOB_CANCEL_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
  if (!response.ok) throw new Error(`media job cancel failed: HTTP ${response.status}`);
  return await response.json();
};

export const listMediaJobs = async (): Promise<MediaJobView[]> => {
  if (!isWebUiBrowserMode()) return (await ipcBridge.media.listJobs.invoke()) || [];
  const response = await fetch(MEDIA_JOBS_ROUTE, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`media jobs list failed: HTTP ${response.status}`);
  return (await response.json()) as MediaJobView[];
};

/**
 * Subscribe to job updates. Returns an unsubscribe.
 *
 * The browser side is Server-Sent Events rather than polling: a generation
 * reports progress for minutes, and polling would either lag visibly or spin
 * against a store that is idle most of the time. `EventSource` also reconnects
 * on its own, which matters for a page left open across a dev restart.
 */
export const subscribeMediaJobs = (onJob: (job: MediaJobView) => void): (() => void) => {
  if (!isWebUiBrowserMode()) {
    const remove = ipcBridge.media.jobUpdated.on(onJob);
    return () => remove?.();
  }

  // Not every non-Electron environment has `EventSource` — jsdom does not, and
  // throwing here would take down any component that merely renders a media
  // surface. Degrade to "snapshot only": the list still loads, it just does not
  // live-update.
  if (typeof EventSource === 'undefined') return () => {};

  const source = new EventSource(MEDIA_JOBS_STREAM_ROUTE);
  source.onmessage = (event) => {
    try {
      onJob(JSON.parse(event.data) as MediaJobView);
    } catch (error) {
      // A malformed frame must not tear down the stream — the next update is
      // still worth receiving.
      console.error('[mediaJobsTransport] Bad job update frame:', error);
    }
  };
  return () => source.close();
};
