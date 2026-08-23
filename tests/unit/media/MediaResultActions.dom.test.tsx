/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Before these actions existed the feature stopped one step short of useful:
 * the generated file was on disk, but the card never said where and offered no
 * way to reach it or ask for another take.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MediaJobView } from '@/common/media/jobView';

const showItemInFolder = vi.fn().mockResolvedValue(undefined);
const startJob = vi.fn().mockResolvedValue({ job: { jobId: 'mj-2' } });

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const emit = vi.fn();
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: (...a: unknown[]) => emit(...a) } }));
let conversationType: string | undefined = 'aionrs';
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => (conversationType ? { type: conversationType } : undefined),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { showItemInFolder: { invoke: (p: string) => showItemInFolder(p) } },
    media: { startJob: { invoke: (p: unknown) => startJob(p) } },
  },
}));

const MediaResultActions = (await import('@/renderer/components/media/MediaResultActions')).default;

const job = (over: Partial<MediaJobView> = {}): MediaJobView => ({
  jobId: 'mj-1',
  kind: 'image',
  status: 'done',
  model: 'gpt-image-2',
  prompt: 'a red bicycle',
  params: { size: '1024x1024' },
  inputUris: ['D:\\ws\\ref.png'],
  origin: { workspaceDir: 'D:\\ws', conversationId: 'c-1' },
  assets: [{ kind: 'image', filePath: 'D:\\ws\\out.png', relativePath: 'out.png', mimeType: 'image/png' }],
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  conversationType = 'aionrs';
  // These cases are about the desktop host. Without this the transport takes
  // the browser branch (jsdom has no `__backendPort`) and posts over HTTP.
  (window as unknown as { __backendPort?: number }).__backendPort = 12345;
});
afterEach(cleanup);

describe('MediaResultActions', () => {
  /**
   * A job with no asset used to render nothing at all, which left a failed
   * generation with no action whatsoever — retrying meant retyping the prompt.
   * The prompt is enough to run it again, so it is now the thing that decides.
   */
  it('still offers to run it again when the job produced no asset', () => {
    render(<MediaResultActions job={job({ status: 'failed', assets: [] })} />);
    expect(screen.getByTestId('media-action-regenerate')).toBeTruthy();
    // Nothing to copy or reveal, though — those need a real file.
    expect(screen.queryByTestId('media-action-copy')).toBeNull();
    expect(screen.queryByTestId('media-action-reveal')).toBeNull();
  });

  it('renders nothing when there is neither an asset nor a prompt to re-run', () => {
    const { container } = render(<MediaResultActions job={job({ status: 'failed', assets: [], prompt: undefined })} />);
    expect(container.firstChild).toBeNull();
  });

  // "Where did my file go" was the single most common dead end.
  it('reveals the generated file in its folder', () => {
    render(<MediaResultActions job={job()} />);
    fireEvent.click(screen.getByTestId('media-action-reveal'));
    expect(showItemInFolder).toHaveBeenCalledWith('D:\\ws\\out.png');
  });

  // Regenerating must reproduce the original request; a default-shaped one
  // would quietly change size/seed/reference and cost money doing it.
  it('regenerates with the original prompt, params, model and references', async () => {
    render(<MediaResultActions job={job()} />);
    fireEvent.click(screen.getByTestId('media-action-regenerate'));

    await waitFor(() => expect(startJob).toHaveBeenCalledTimes(1));
    expect(startJob).toHaveBeenCalledWith({
      kind: 'image',
      prompt: 'a red bicycle',
      params: { size: '1024x1024' },
      inputUris: ['D:\\ws\\ref.png'],
      workspaceDir: 'D:\\ws',
      model: 'gpt-image-2',
      conversationId: 'c-1',
    });
  });

  /**
   * The whole point of this button. Verified 2026-08-07 that the agent's
   * context comes from the dream on-disk session / the ACP CLI transcript and
   * *not* from the conversation message table, so the attachment channel is
   * the only route by which a send-box generation can reach the agent.
   */
  it('hands the file to the send box of this conversation type', () => {
    render(<MediaResultActions job={job()} />);
    fireEvent.click(screen.getByTestId('media-action-attach'));
    expect(emit).toHaveBeenCalledWith('aionrs.selected.file.append', ['D:\\ws\\out.png'], 'c-1');
  });

  // Event names are per platform; routing to the wrong one silently does
  // nothing, which would look like the button being broken.
  it('routes to the ACP send box in an ACP conversation', () => {
    conversationType = 'acp';
    render(<MediaResultActions job={job()} />);
    fireEvent.click(screen.getByTestId('media-action-attach'));
    expect(emit).toHaveBeenCalledWith('acp.selected.file.append', ['D:\\ws\\out.png'], 'c-1');
  });

  it('hides attach outside a conversation, where there is no send box to hand it to', () => {
    conversationType = undefined;
    render(<MediaResultActions job={job()} />);
    expect(screen.queryByTestId('media-action-attach')).toBeNull();
  });

  it('offers copy for an image but not for a video', () => {
    const { rerender } = render(<MediaResultActions job={job()} />);
    expect(screen.queryByTestId('media-action-copy')).toBeTruthy();

    rerender(
      <MediaResultActions
        job={job({
          kind: 'video',
          assets: [{ kind: 'video', filePath: 'D:\\ws\\a.mp4', relativePath: 'a.mp4', mimeType: 'video/mp4' }],
        })}
      />
    );
    expect(screen.queryByTestId('media-action-copy')).toBeNull();
  });

  // A job recovered from before `prompt` was recorded cannot be reproduced, so
  // the button must not offer to do it.
  it('hides regenerate when the prompt was never recorded', () => {
    render(<MediaResultActions job={job({ prompt: undefined })} />);
    expect(screen.queryByTestId('media-action-regenerate')).toBeNull();
  });
});

/**
 * "Reveal in folder" runs wherever `/api/shell/*` is answered.
 *
 * ⚠️ The desktop app — **including in enterprise remote mode** — always answers
 * it locally: `/api/shell/*` is not a governance path, and `routesToRemote`
 * only sends governance paths to the server. So revealing works there and must
 * keep working. The broken case is a browser on another machine, where the
 * folder opens on the server's desktop with nobody watching.
 */
describe('MediaResultActions on a remote host', () => {
  const setHost = (hostname?: string) => {
    if (hostname === undefined) {
      delete (window as unknown as { __backendPort?: number }).__backendPort;
      return;
    }
    delete (window as unknown as { __backendPort?: number }).__backendPort;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname },
      writable: true,
      configurable: true,
    });
  };

  afterEach(() => {
    (window as unknown as { __backendPort?: number }).__backendPort = 12345;
  });

  it('keeps "reveal in folder" in the desktop app', () => {
    (window as unknown as { __backendPort?: number }).__backendPort = 12345;
    render(<MediaResultActions job={job()} />);
    expect(screen.getByTestId('media-action-reveal')).toBeTruthy();
    expect(screen.queryByTestId('media-action-download')).toBeNull();
  });

  it('keeps "reveal in folder" for a browser on this very machine', () => {
    setHost('127.0.0.1');
    render(<MediaResultActions job={job()} />);
    expect(screen.getByTestId('media-action-reveal')).toBeTruthy();
  });

  it('offers a download instead when the browser is on another machine', () => {
    setHost('192.168.1.50');
    render(<MediaResultActions job={job()} />);
    expect(screen.getByTestId('media-action-download')).toBeTruthy();
    expect(screen.queryByTestId('media-action-reveal')).toBeNull();
  });

  it('downloads through the media route rather than calling the shell', () => {
    setHost('192.168.1.50');
    const clicked: Array<{ href: string; download: string }> = [];
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') el.click = () => clicked.push({ href: el.getAttribute('href') || '', download: el.download });
      return el;
    });

    render(<MediaResultActions job={job()} />);
    fireEvent.click(screen.getByTestId('media-action-download'));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toContain('/media/file?path=');
    expect(clicked[0].download).toBe('out.png');
    expect(showItemInFolder).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
