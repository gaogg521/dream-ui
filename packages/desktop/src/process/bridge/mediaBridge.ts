/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exposes the main-process media job engine to the renderer.
 *
 * The engine already owned everything a UI needs — state machine, persistence,
 * restart recovery, cancellation — but nothing reached the window: progress was
 * only pushed back down the MCP socket. That left the design's third safety net
 * (a visible surface that survives the agent) unbuilt, so a video that took
 * three minutes looked like nothing was happening.
 *
 * The bridge is intentionally thin: no filtering, no conversation logic. It
 * ships every job to the renderer and lets each surface decide what it owns
 * (see `MediaJobOrigin` for why attribution is resolved up there).
 */

import { ipcBridge } from '@/common';
import { toMediaJobView } from '@process/services/mediaJob/types';
import { getMediaJobManager, startMediaJob } from '@process/services/mediaJob';

/**
 * The job-store half of the WebUI's media route, in one place.
 *
 * The browser has no Electron IPC bridge, so everything the desktop renderer
 * gets over `ipcBridge.media.*` has to be reachable over HTTP as well. Defining
 * it here rather than at each wiring site keeps the two hosts on one
 * implementation: "start a job" must mean the same thing whichever one asked,
 * or the difference shows up as a generation that behaves differently in the
 * browser than in the app.
 */
export const mediaJobRouteDeps = () => ({
  listJobs: () => getMediaJobManager().listJobs().map(toMediaJobView),
  subscribeJobs: (onJob: (job: ReturnType<typeof toMediaJobView>) => void) =>
    getMediaJobManager().onJobUpdate((job) => onJob(toMediaJobView(job))),
  startJob: async (input: Record<string, unknown>) => {
    const started = await startMediaJob(input as never);
    return started.job ? { job: toMediaJobView(started.job) } : { error: started.error };
  },
  cancelJob: async (jobId: string) => getMediaJobManager().cancel(jobId),
});

let installed = false;

export const initMediaBridge = (): void => {
  // The engine is a singleton and this can be reached from more than one
  // startup path; subscribing twice would double every broadcast.
  if (installed) return;
  installed = true;

  const manager = getMediaJobManager();

  ipcBridge.media.startJob.provider(async (input) => {
    const started = await startMediaJob(input);
    return started.job ? { job: toMediaJobView(started.job) } : { error: started.error };
  });

  ipcBridge.media.listJobs.provider(async () => manager.listJobs().map(toMediaJobView));

  ipcBridge.media.cancelJob.provider(async ({ jobId }) => manager.cancel(jobId));

  manager.onJobUpdate((job) => {
    ipcBridge.media.jobUpdated.emit(toMediaJobView(job));
  });
};
