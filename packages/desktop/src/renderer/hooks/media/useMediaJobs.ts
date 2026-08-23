/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Subscribe to media generation jobs running in the main process.
 *
 * Snapshot plus stream, not stream alone: jobs deliberately outlive the tool
 * call and the window, so a surface that only listened for updates would show
 * nothing after a reload until the next progress tick — and nothing at all for
 * a job that finished while the window was closed.
 *
 * Every surface shares this one subscription and filters it, which is why the
 * hook takes a filter rather than exposing several specialized hooks: adding a
 * conversation-scoped view later is a filter, not new plumbing.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import { isActiveStatus, jobBelongsToConversation, type MediaJobView } from '@/common/media/jobView';
import { cancelMediaJob, listMediaJobs, subscribeMediaJobs } from './mediaJobsTransport';

export type MediaJobFilter = {
  /** Limit to jobs generated into this workspace. */
  workspaceDir?: string;
  /** Prefer conversation ownership when the job carries one. */
  conversationId?: string;
  /** Limit to jobs still doing work. */
  activeOnly?: boolean;
};

const sortByCreatedDesc = (jobs: MediaJobView[]): MediaJobView[] =>
  [...jobs].toSorted((a, b) => b.createdAt - a.createdAt);

export const useMediaJobs = (filter: MediaJobFilter = {}) => {
  const [jobs, setJobs] = useState<MediaJobView[]>([]);
  const { workspaceDir, conversationId, activeOnly } = filter;

  useEffect(() => {
    let cancelled = false;

    // Starting state first, so an in-flight job is visible immediately rather
    // than only after it happens to tick.
    void listMediaJobs()
      .then((initial) => {
        if (!cancelled) setJobs(sortByCreatedDesc(initial || []));
      })
      .catch((error) => {
        console.error('[useMediaJobs] Failed to load media jobs:', error);
      });

    const removeListener = subscribeMediaJobs((job: MediaJobView) => {
      if (cancelled) return;
      setJobs((prev) => {
        const index = prev.findIndex((item) => item.jobId === job.jobId);
        // Upsert: an update can arrive for a job created after the snapshot.
        if (index === -1) return sortByCreatedDesc([job, ...prev]);
        const next = [...prev];
        next[index] = job;
        return next;
      });
    });

    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  const visible = useMemo(() => {
    let result = jobs;
    if (workspaceDir || conversationId) {
      result = result.filter((job) => jobBelongsToConversation(job, conversationId, workspaceDir));
    }
    if (activeOnly) result = result.filter((job) => isActiveStatus(job.status));
    return result;
  }, [jobs, workspaceDir, conversationId, activeOnly]);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      return await cancelMediaJob(jobId);
    } catch (error) {
      console.error('[useMediaJobs] Failed to cancel media job:', error);
      return false;
    }
  }, []);

  const activeCount = useMemo(() => visible.filter((job) => isActiveStatus(job.status)).length, [visible]);

  return { jobs: visible, activeCount, cancelJob };
};
