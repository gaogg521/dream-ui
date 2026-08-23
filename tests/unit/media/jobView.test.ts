/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isActiveStatus, isTerminalStatus, jobBelongsToWorkspace, normalizeWorkspaceKey } from '@/common/media/jobView';
import { toMediaJobView } from '@process/services/mediaJob/types';
import type { MediaJobRecord } from '@process/services/mediaJob/types';

const record = (over: Partial<MediaJobRecord> = {}): MediaJobRecord => ({
  id: 'mj-1',
  kind: 'video',
  status: 'polling',
  prompt: 'a cat',
  params: {},
  inputUris: [],
  providerId: 'p1',
  model: 'seedance-2-0-fast',
  workspaceDir: 'D:\\ws',
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

describe('job status helpers', () => {
  it('splits terminal from active', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('timeout')).toBe(true);
    expect(isActiveStatus('polling')).toBe(true);
    expect(isActiveStatus('cancelled')).toBe(false);
  });
});

describe('workspace attribution', () => {
  // The same directory legitimately arrives spelled differently (a tool passes
  // forward slashes, the app stores backslashes); a false negative would hide a
  // running job from the surface the user is looking at.
  it('matches across separator and case differences', () => {
    const job = toMediaJobView(record({ workspaceDir: 'D:\\ws\\project' }));
    expect(jobBelongsToWorkspace(job, 'D:/ws/project')).toBe(true);
    expect(jobBelongsToWorkspace(job, 'd:\\WS\\Project\\')).toBe(true);
    expect(jobBelongsToWorkspace(job, 'D:\\ws\\other')).toBe(false);
  });

  it('normalizes trailing separators and empties', () => {
    expect(normalizeWorkspaceKey('/a/b/')).toBe('/a/b');
    expect(normalizeWorkspaceKey('')).toBe('');
  });
});

describe('toMediaJobView', () => {
  it('projects a record into the shared public shape', () => {
    const view = toMediaJobView(
      record({
        assets: [
          {
            kind: 'video',
            filePath: 'D:\\ws\\out.mp4',
            relativePath: 'out.mp4',
            mimeType: 'video/mp4',
            durationSeconds: 5,
          },
        ],
      })
    );
    expect(view.jobId).toBe('mj-1');
    expect(view.assets?.[0]).toEqual({
      kind: 'video',
      filePath: 'D:\\ws\\out.mp4',
      relativePath: 'out.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 5,
      coverFramePath: undefined,
    });
  });

  // A media request never becomes a conversation message, so the prompt on the
  // job is the only record of what was asked; without it two failed attempts on
  // the same model render as indistinguishable duplicates.
  it('carries the prompt so a card can say what was asked for', () => {
    expect(toMediaJobView(record({ prompt: 'a red bicycle' })).prompt).toBe('a red bicycle');
  });

  // The cost shown on a card is priced off the user's declared unit price, which
  // lives on one specific provider. Without this field the renderer would have to
  // match by model name — and the same name on two providers can carry two
  // prices, so the figure would sometimes be attributed to the wrong contract.
  it('carries the provider so a cost can be priced against the right one', () => {
    expect(toMediaJobView(record({ providerId: 'prov-7' })).providerId).toBe('prov-7');
  });

  // Records written before `origin` existed must still attribute, otherwise a
  // job recovered from an older jobs file would be invisible everywhere.
  it('back-fills origin from workspaceDir for older records', () => {
    const view = toMediaJobView(record({ origin: undefined, workspaceDir: '/home/u/ws' }));
    expect(view.origin).toEqual({ workspaceDir: '/home/u/ws' });
    expect(jobBelongsToWorkspace(view, '/home/u/ws')).toBe(true);
  });

  it('prefers an explicit origin when present', () => {
    const view = toMediaJobView(record({ workspaceDir: '/a', origin: { workspaceDir: '/a', conversationId: 'c-9' } }));
    expect(view.origin.conversationId).toBe('c-9');
  });

  // Rule D6: no channel may carry media bytes.
  it('never leaks anything but paths for assets', () => {
    const view = toMediaJobView(
      record({ assets: [{ kind: 'image', filePath: '/a/b.png', relativePath: 'b.png', mimeType: 'image/png' }] })
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('base64');
    expect(serialized).not.toContain('b64_json');
  });
});
