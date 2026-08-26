/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The fence on the media HTTP route.
 *
 * This route is a materially larger exposure than the `one-media://` scheme it
 * mirrors: that one is reachable only from this process's own renderer, while
 * this one answers anyone who can reach the WebUI — other machines included, in
 * remote mode. Everything below is the security boundary, so it is asserted
 * directly rather than inferred from the happy path working.
 *
 * The escape cases use a **real link on disk**, not a crafted string: the fence
 * resolves real paths, and a string-level test would pass even against an
 * implementation that never called `realpath`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { authorizeMediaPath, handleMediaHttpRequest, isInsideRoot } from '@process/services/mediaHttpRoute';

let root: string;
let outside: string;
let insideFile: string;
let outsideFile: string;
const deps = { listAllowedRoots: async () => [root], listServableFiles: () => [] as string[] };

beforeAll(async () => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-route-'));
  root = path.join(base, 'workspace');
  outside = path.join(base, 'secrets');
  await fs.promises.mkdir(root);
  await fs.promises.mkdir(outside);
  insideFile = path.join(root, 'ok.png');
  outsideFile = path.join(outside, 'private.png');
  await fs.promises.writeFile(insideFile, 'png-bytes');
  await fs.promises.writeFile(outsideFile, 'secret-bytes');
  await fs.promises.writeFile(path.join(root, 'notes.txt'), 'text');
});

afterAll(async () => {
  await fs.promises.rm(path.dirname(root), { recursive: true, force: true }).catch(() => {});
});

describe('isInsideRoot', () => {
  it('accepts the root itself and anything under it', () => {
    expect(isInsideRoot(root, root)).toBe(true);
    expect(isInsideRoot(path.join(root, 'a', 'b.png'), root)).toBe(true);
  });

  /**
   * A plain `startsWith` would call `…/workspace-secrets` a child of
   * `…/workspace`. That is a prefix match wearing containment's clothes.
   */
  it('rejects a sibling whose name merely starts with the root', () => {
    expect(isInsideRoot(`${root}-secrets/x.png`, root)).toBe(false);
  });

  it('rejects a path that climbs out', () => {
    expect(isInsideRoot(path.join(root, '..', 'secrets', 'x.png'), root)).toBe(false);
  });

  it('rejects an empty root rather than treating it as "anywhere"', () => {
    expect(isInsideRoot(insideFile, '')).toBe(false);
  });
});

describe('authorizeMediaPath', () => {
  it('serves a media file inside an allowed root', async () => {
    const verdict = await authorizeMediaPath(insideFile, deps);
    expect(verdict.ok).toBe(true);
  });

  it('refuses a file outside every allowed root', async () => {
    const verdict = await authorizeMediaPath(outsideFile, deps);
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  /**
   * The traversal case. `path.resolve` normalizes the `..` away, so what the
   * fence actually sees is the outside path — which is the point: normalize
   * first, then judge, never judge the raw string.
   */
  it('refuses a traversal that climbs out of the root', async () => {
    const verdict = await authorizeMediaPath(path.join(root, '..', 'secrets', 'private.png'), deps);
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  /**
   * The case a string-only fence cannot catch: a link that *is* inside the root
   * but points out of it. Only resolving the real path rejects this.
   *
   * ⚠️ Uses a **directory junction**, not a file symlink. A file symlink needs
   * elevation on Windows — the first version of this test caught the `EPERM`
   * and returned, so the single most important escape case reported a pass
   * without ever running. A junction needs no privileges, and `realpath` was
   * measured to resolve through it, so this now actually exercises the fence.
   */
  it('refuses a path that reaches outside through a link inside the root', async () => {
    const link = path.join(root, 'linked');
    await fs.promises.symlink(outside, link, 'junction');
    const viaLink = path.join(link, 'private.png');

    // Precondition: the escape is real — without the fence this path reads the
    // outside file. Asserting it here stops the test from passing for the wrong
    // reason (e.g. the link silently not existing).
    expect(await fs.promises.realpath(viaLink)).toBe(await fs.promises.realpath(outsideFile));

    const verdict = await authorizeMediaPath(viaLink, deps);
    expect(verdict).toMatchObject({ ok: false, status: 403 });
    await fs.promises.rm(link, { recursive: true, force: true });
  });

  /**
   * Second, independent guard. Even a file sitting legitimately inside an
   * allowed root must not be readable through this channel unless it is media —
   * the workspace is the user's own folder and can hold anything.
   */
  it('refuses a non-media file even inside an allowed root', async () => {
    const verdict = await authorizeMediaPath(path.join(root, 'notes.txt'), deps);
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  it('reports a missing file as not found, not as a fence violation', async () => {
    const verdict = await authorizeMediaPath(path.join(root, 'gone.png'), deps);
    expect(verdict).toMatchObject({ ok: false, status: 404 });
  });

  it('rejects a request with no path', async () => {
    expect(await authorizeMediaPath(null, deps)).toMatchObject({ ok: false, status: 400 });
  });

  it('refuses everything when no root is configured', async () => {
    const verdict = await authorizeMediaPath(insideFile, {
      listAllowedRoots: async () => [],
      listServableFiles: () => [],
    });
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  /**
   * Windows spells the same directory several ways. Asserted rather than
   * assumed — a case-sensitive comparison here would reject legitimate paths on
   * the platform this app mainly ships to, and nothing else would catch it.
   */
  it.runIf(process.platform === 'win32')('accepts a root spelled with different case', async () => {
    const verdict = await authorizeMediaPath(insideFile, {
      listAllowedRoots: async () => [root.toUpperCase()],
      listServableFiles: () => [],
    });
    expect(verdict.ok).toBe(true);
  });
});

/**
 * The job routes.
 *
 * These exist because the browser has no Electron IPC bridge, so the WebUI
 * received no jobs at all and rendered no cards — the missing piece behind
 * "the WebUI shows nothing", which looked like broken images but never got as
 * far as an image.
 */
// `workspaceDir` on a start-job request is never validated, so it must not be
// able to widen what the file route will hand out. Job workspaces used to be
// allowed roots, which made `{"workspaceDir":"C:\\"}` enough to read any image
// on the machine.
describe('a caller-named workspace does not widen the fence', () => {
  it('still refuses a file outside the root even when its directory is named as a job workspace', async () => {
    const verdict = await authorizeMediaPath(outsideFile, {
      // What a fabricated `workspaceDir` would have contributed before.
      listAllowedRoots: async () => [root],
      listServableFiles: () => [],
    });
    expect(verdict.ok).toBe(false);
  });

  it('serves a generated file outside the root when it is one this app produced', async () => {
    const verdict = await authorizeMediaPath(outsideFile, {
      listAllowedRoots: async () => [root],
      listServableFiles: () => [outsideFile],
    });
    expect(verdict.ok).toBe(true);
  });

  it('does not let a registered file authorise its neighbours', async () => {
    const sibling = path.join(outside, 'other.png');
    await fs.promises.writeFile(sibling, 'png-bytes');
    const verdict = await authorizeMediaPath(sibling, {
      listAllowedRoots: async () => [root],
      listServableFiles: () => [outsideFile],
    });
    expect(verdict.ok).toBe(false);
  });
});

describe('job routes', () => {
  const job = { jobId: 'j1', kind: 'image', status: 'done', model: 'm', origin: { workspaceDir: 'D:/ws' } };

  const fakeRes = () => {
    const chunks: string[] = [];
    let status = 0;
    let headers: Record<string, string> = {};
    const handlers: Record<string, () => void> = {};
    return {
      chunks,
      get status() {
        return status;
      },
      get headers() {
        return headers;
      },
      writeHead: (s: number, h: Record<string, string>) => {
        status = s;
        headers = h;
      },
      write: (c: string) => chunks.push(c),
      end: (c?: string) => {
        if (c) chunks.push(c);
      },
      on: (event: string, cb: () => void) => {
        handlers[event] = cb;
      },
      fire: (event: string) => handlers[event]?.(),
    };
  };
  const fakeReq = (url: string) => ({ url, method: 'GET', headers: {}, on: () => {} });

  const jobDeps = (over: Partial<Parameters<typeof authorizeMediaPath>[1]> = {}) => ({
    listAllowedRoots: async () => [root],
    listServableFiles: () => [],
    listJobs: () => [job],
    subscribeJobs: () => () => {},
    startJob: async () => ({ job }),
    cancelJob: async () => ({ ok: true }),
    ...over,
  });

  it('serves the current jobs as JSON', async () => {
    const res = fakeRes();
    const handled = await handleMediaHttpRequest(fakeReq('/media/jobs') as never, res as never, jobDeps() as never);
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/json');
    expect(JSON.parse(res.chunks.join(''))).toEqual([job]);
  });

  it('opens the update stream as SSE and pushes each job', async () => {
    let emit: ((j: unknown) => void) | undefined;
    const res = fakeRes();
    await handleMediaHttpRequest(
      fakeReq('/media/jobs/stream') as never,
      res as never,
      jobDeps({ subscribeJobs: (cb: (j: unknown) => void) => ((emit = cb), () => {}) }) as never
    );
    expect(res.headers['Content-Type']).toContain('text/event-stream');
    // Buffering proxies would hold every event until the response ends, and a
    // stream never ends.
    expect(res.headers['X-Accel-Buffering']).toBe('no');

    emit?.(job);
    expect(res.chunks.join('')).toContain(`data: ${JSON.stringify(job)}`);
  });

  it('unsubscribes when the client goes away', async () => {
    let unsubscribed = false;
    const res = fakeRes();
    await handleMediaHttpRequest(
      fakeReq('/media/jobs/stream') as never,
      res as never,
      jobDeps({ subscribeJobs: () => () => (unsubscribed = true) }) as never
    );
    res.fire('close');
    expect(unsubscribed).toBe(true);
  });

  /**
   * Starting and cancelling from the browser.
   *
   * ⚠️ These spend money, so the assertions are about not spending it by
   * accident: a malformed body must be refused rather than passed on, and
   * `GET /media/jobs` must keep meaning "list" — if the method were ignored,
   * every page load would submit a generation.
   */
  const bodyReq = (url: string, method: string, body?: string) => {
    const handlers: Record<string, (chunk?: Buffer) => void> = {};
    const req = {
      url,
      method,
      headers: {},
      on: (event: string, cb: (chunk?: Buffer) => void) => {
        handlers[event] = cb;
        if (event === 'end') {
          if (body !== undefined) handlers.data?.(Buffer.from(body));
          cb();
        }
      },
      destroy: () => {},
    };
    return req;
  };

  it('starts a job from a posted body', async () => {
    const started: unknown[] = [];
    const res = fakeRes();
    await handleMediaHttpRequest(
      bodyReq('/media/jobs', 'POST', JSON.stringify({ kind: 'image', prompt: 'a cat' })) as never,
      res as never,
      jobDeps({ startJob: async (i: unknown) => (started.push(i), { job }) }) as never
    );

    expect(started).toEqual([{ kind: 'image', prompt: 'a cat' }]);
    expect(JSON.parse(res.chunks.join(''))).toEqual({ job });
  });

  it('refuses a malformed body instead of starting anything', async () => {
    let called = false;
    const res = fakeRes();
    await handleMediaHttpRequest(
      bodyReq('/media/jobs', 'POST', 'not json') as never,
      res as never,
      jobDeps({ startJob: async () => ((called = true), { job }) }) as never
    );

    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  // The list and the start share a path; only the method separates them.
  it('still lists on GET rather than treating it as a submission', async () => {
    let called = false;
    const res = fakeRes();
    await handleMediaHttpRequest(
      fakeReq('/media/jobs') as never,
      res as never,
      jobDeps({ startJob: async () => ((called = true), { job }) }) as never
    );

    expect(called).toBe(false);
    expect(JSON.parse(res.chunks.join(''))).toEqual([job]);
  });

  it('cancels the job it was given', async () => {
    const cancelled: string[] = [];
    const res = fakeRes();
    await handleMediaHttpRequest(
      bodyReq('/media/jobs/cancel', 'POST', JSON.stringify({ jobId: 'j1' })) as never,
      res as never,
      jobDeps({ cancelJob: async (id: string) => (cancelled.push(id), { ok: true }) }) as never
    );

    expect(cancelled).toEqual(['j1']);
  });

  it('refuses a cancel with no job id', async () => {
    const res = fakeRes();
    await handleMediaHttpRequest(
      bodyReq('/media/jobs/cancel', 'POST', JSON.stringify({})) as never,
      res as never,
      jobDeps() as never
    );
    expect(res.status).toBe(400);
  });

  it('leaves unrelated paths to the caller', async () => {
    const res = fakeRes();
    expect(await handleMediaHttpRequest(fakeReq('/index.html') as never, res as never, jobDeps() as never)).toBe(false);
  });
});
