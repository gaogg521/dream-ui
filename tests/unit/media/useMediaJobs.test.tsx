/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { MediaJobView } from '@/common/media/jobView';

const hooks = vi.hoisted(() => {
  let emit: ((job: MediaJobView) => void) | null = null;
  return {
    listJobs: vi.fn(),
    cancelJob: vi.fn(() => Promise.resolve(true)),
    on: vi.fn((cb: (job: MediaJobView) => void) => {
      emit = cb;
      return () => {
        emit = null;
      };
    }),
    fire: (job: MediaJobView) => emit?.(job),
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    media: {
      listJobs: { invoke: hooks.listJobs },
      cancelJob: { invoke: hooks.cancelJob },
      jobUpdated: { on: hooks.on },
    },
  },
}));

const { useMediaJobs } = await import('@renderer/hooks/media/useMediaJobs');

const job = (over: Partial<MediaJobView> = {}): MediaJobView => ({
  jobId: 'mj-1',
  kind: 'video',
  status: 'polling',
  model: 'seedance',
  origin: { workspaceDir: 'D:\\ws' },
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

const Probe: React.FC<{ workspaceDir?: string; activeOnly?: boolean }> = ({ workspaceDir, activeOnly }) => {
  const { jobs, activeCount } = useMediaJobs({ workspaceDir, activeOnly });
  return (
    <div>
      <span data-testid='count'>{jobs.length}</span>
      <span data-testid='active'>{activeCount}</span>
      <span data-testid='ids'>{jobs.map((j) => `${j.jobId}:${j.status}`).join(',')}</span>
    </div>
  );
};

describe('useMediaJobs', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // A window that only listened for updates would be blind to everything
  // already running — the exact case the job engine exists to survive.
  it('seeds from the snapshot before any event arrives', async () => {
    hooks.listJobs.mockResolvedValueOnce([job({ jobId: 'existing' })]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('ids').textContent).toBe('existing:polling');
  });

  it('updates a job in place rather than duplicating it', async () => {
    hooks.listJobs.mockResolvedValueOnce([job({ jobId: 'mj-1', status: 'polling' })]);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    hooks.fire(job({ jobId: 'mj-1', status: 'done' }));
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('mj-1:done'));
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('upserts a job created after the snapshot', async () => {
    hooks.listJobs.mockResolvedValueOnce([]);
    render(<Probe />);
    await waitFor(() => expect(hooks.on).toHaveBeenCalled());

    hooks.fire(job({ jobId: 'fresh' }));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('filters by workspace with separators normalized', async () => {
    hooks.listJobs.mockResolvedValueOnce([
      job({ jobId: 'mine', origin: { workspaceDir: 'D:\\ws' } }),
      job({ jobId: 'other', origin: { workspaceDir: 'D:\\elsewhere' } }),
    ]);
    render(<Probe workspaceDir='D:/ws' />);
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('mine:polling'));
  });

  it('can hide finished jobs', async () => {
    hooks.listJobs.mockResolvedValueOnce([
      job({ jobId: 'running', status: 'polling' }),
      job({ jobId: 'finished', status: 'done' }),
    ]);
    render(<Probe activeOnly />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(screen.getByTestId('active').textContent).toBe('1');
  });

  it('survives a failing snapshot instead of crashing the surface', async () => {
    hooks.listJobs.mockRejectedValueOnce(new Error('bridge down'));
    render(<Probe />);
    await waitFor(() => expect(hooks.on).toHaveBeenCalled());
    expect(screen.getByTestId('count').textContent).toBe('0');

    // The stream still works once it recovers.
    hooks.fire(job({ jobId: 'later' }));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});
