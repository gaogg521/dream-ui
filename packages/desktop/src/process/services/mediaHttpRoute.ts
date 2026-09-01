/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HTTP delivery of generated media, for the browser.
 *
 * `one-media://` is an Electron protocol handler: it exists only inside the
 * desktop window. The WebUI runs the *same* renderer bundle in an ordinary
 * browser, where that scheme does not resolve at all — so every generated image
 * and video was a broken element there. Code being shared did not make the
 * capability shared; anything touching a custom protocol, an Electron API, or a
 * local file path forks between the two hosts.
 *
 * ## Why this is not under `/api/`
 *
 * The static server reverse-proxies all of `/api/*` to dreamcore, and dreamcore
 * has no knowledge of the media job store (a JSON file owned by this process).
 * A route there could not enforce the fence below. This one is served by the
 * static server itself, which runs here.
 *
 * ## Security boundary
 *
 * This is a materially larger exposure than `one-media://`: that scheme is only
 * reachable from the renderer of this very process, whereas this route answers
 * anyone who can reach the WebUI — including, in remote/enterprise mode, other
 * machines. It therefore carries **two** independent guards, and a request must
 * pass both:
 *
 * 1. **Extension allowlist** — the same image/video set `one-media://` uses.
 *    Keeps source, config and credential files out of this channel even if the
 *    fence below were ever widened by mistake.
 * 2. **Real-path fence** — the file must resolve inside an allowed root. Roots
 *    are the workspaces the media job store has recorded, plus the app's own
 *    work directory.
 *
 * The fence compares **resolved real paths** (`fs.realpath`), not the strings as
 * given. That is what makes `..`, a symlink, or a Windows junction pointing out
 * of the workspace fail — checking the raw string would pass them straight
 * through. Comparison is case-insensitive on Windows because the same directory
 * legitimately arrives spelled differently there.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, VIDEO_EXTENSIONS, VIDEO_MIME_TYPE_MAP } from '@/common/config/constants';
import type { MediaJobView } from '@/common/media/jobView';
import {
  MEDIA_HTTP_ROUTE,
  MEDIA_JOB_CANCEL_ROUTE,
  MEDIA_JOBS_ROUTE,
  MEDIA_JOBS_STREAM_ROUTE,
} from '@/common/media/mediaUrl';
import { parseRangeHeader } from './mediaProtocol';

export { MEDIA_HTTP_ROUTE, MEDIA_JOB_CANCEL_ROUTE, MEDIA_JOBS_ROUTE, MEDIA_JOBS_STREAM_ROUTE };

const SERVABLE_EXTENSIONS = new Set<string>([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

const mimeTypeFor = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPE_MAP[ext] || VIDEO_MIME_TYPE_MAP[ext] || 'application/octet-stream';
};

/**
 * Is `target` inside `root`?
 *
 * Both are expected to be already-resolved real paths.
 *
 * Uses `path.relative` rather than a string prefix: `C:\ws-secrets`.startsWith(
 * `C:\ws`) is true, so a prefix test would call a sibling directory a child.
 * It also gives platform-correct case handling for free — measured on Windows,
 * a root spelled in a different case still resolves as containing.
 */
export const isInsideRoot = (target: string, root: string): boolean => {
  if (!root) return false;
  const relative = path.relative(root, target);
  // `path.relative` gives '' for the root itself, and anything escaping the
  // root starts with '..'. An absolute result means different drives.
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Resolve to a real path, tolerating a file that does not exist.
 *
 * A missing file must not throw here — it should fall through to a normal 404
 * rather than being reported as a fence violation, which would be a misleading
 * diagnosis for a legitimately deleted asset.
 */
const realPathOrNull = async (candidate: string): Promise<string | null> => {
  try {
    return await fs.promises.realpath(candidate);
  } catch {
    return null;
  }
};

export type MediaRouteDeps = {
  /** Directories whose contents may be served. Re-read per request. */
  listAllowedRoots: () => Promise<string[]>;
  /**
   * Exact files this route may serve regardless of where they live.
   *
   * Job workspaces used to be allowed *roots*, which made the fence only as
   * trustworthy as its inputs: `workspaceDir` comes straight off the start-job
   * request and is never validated, so `POST /media/jobs {"workspaceDir":"C:\\"}`
   * registered `C:\` as a root and `/media/file` would then hand over any image
   * or video on the machine.
   *
   * The generated files themselves are not attacker-chosen, so listing them
   * individually keeps every legitimate preview working — a generation into a
   * project directory is still servable — while a made-up workspace grants
   * nothing, because a directory is not a file this route ever produced.
   */
  listServableFiles: () => string[];
  /** Current jobs, in the same shape the IPC bridge hands the desktop renderer. */
  listJobs: () => MediaJobView[];
  /** Live job updates. Returns an unsubscribe. */
  subscribeJobs: (onJob: (job: MediaJobView) => void) => () => void;
  /** Start a generation. Same input and result as the IPC channel. */
  startJob: (input: Record<string, unknown>) => Promise<unknown>;
  /** Cancel one. Same result as the IPC channel. */
  cancelJob: (jobId: string) => Promise<unknown>;
};

/**
 * Read a JSON request body, or null if it is absent or unparseable.
 *
 * Capped: this route is reachable by anyone who can reach the WebUI, and an
 * unbounded read would let one request grow the main process's memory until it
 * dies. A generation request is a prompt and a few parameters — a megabyte is
 * already far more than that, except when a reference image rides along as a
 * data URI, which is why the ceiling is not tighter.
 */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const readJsonBody = async (req: IncomingMessage): Promise<unknown | null> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });

type Verdict = { ok: true; filePath: string; size: number } | { ok: false; status: number; reason: string };

/**
 * Decide whether a requested path may be served. Exported for tests — the fence
 * is the security-relevant part and deserves assertions of its own, separate
 * from the streaming plumbing.
 */
export const authorizeMediaPath = async (
  rawPath: string | null,
  deps: Pick<MediaRouteDeps, 'listAllowedRoots' | 'listServableFiles'>
): Promise<Verdict> => {
  if (!rawPath) return { ok: false, status: 400, reason: 'missing path' };

  // Extension is checked before touching the filesystem: a rejected type should
  // not even reveal whether the file exists.
  const requested = path.resolve(rawPath);
  if (!SERVABLE_EXTENSIONS.has(path.extname(requested).toLowerCase())) {
    return { ok: false, status: 403, reason: 'unsupported media type' };
  }

  const real = await realPathOrNull(requested);
  if (!real) return { ok: false, status: 404, reason: 'not found' };

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(real);
  } catch {
    return { ok: false, status: 404, reason: 'not found' };
  }
  if (!stat.isFile()) return { ok: false, status: 404, reason: 'not a file' };

  const roots = await deps.listAllowedRoots();
  const realRoots = (await Promise.all(roots.map(realPathOrNull))).filter((entry): entry is string => !!entry);
  if (realRoots.some((root) => isInsideRoot(real, root))) {
    return { ok: true, filePath: real, size: stat.size };
  }

  // Outside every root, the file still qualifies if it is one this route
  // actually produced. Compared after `realpath` on both sides so a link cannot
  // masquerade as a registered asset.
  const servable = (await Promise.all((deps.listServableFiles() || []).map(realPathOrNull))).filter(
    (entry): entry is string => !!entry
  );
  if (servable.some((candidate) => path.relative(candidate, real) === '')) {
    return { ok: true, filePath: real, size: stat.size };
  }

  return { ok: false, status: 403, reason: 'outside allowed roots' };
};

/**
 * The roots this route will serve from: every workspace the media job store has
 * recorded, plus the app's own work directory.
 *
 * Read fresh per request rather than snapshotted at startup — a workspace
 * becomes servable the moment a generation lands in it, and the WebUI may
 * already be open.
 *
 * ⚠️ The workspaces are **injected**, not imported. A first version reached for
 * them with a lazy `require('./mediaJob')`, on the theory that a runtime require
 * avoids dragging the Electron IPC bridge into this module's consumers (the
 * tests mock only part of that graph). It bundled to a literal
 * `require("./mediaJob")` in `out/main/index.js`, which at runtime resolves
 * against `out/main/` where no such module exists — so it threw on every
 * request, the catch swallowed it, and the fence silently fell back to the work
 * directory alone. Generated media outside it was 403 while media inside it
 * worked, which reads as a fence bug rather than a missing root.
 *
 * Injection removes the runtime resolution entirely and keeps this module free
 * of the job service, so the tests still need no mocks.
 */
export const createMediaRouteDeps = (
  appWorkDir: string | undefined,
  jobs: Pick<MediaRouteDeps, 'listJobs' | 'subscribeJobs' | 'startJob' | 'cancelJob'>
): MediaRouteDeps => ({
  ...jobs,
  // The app's own work directory is the one root, and it is ours rather than
  // the caller's: every conversation-scoped generation lands under it, so those
  // previews keep working for as long as the files do — including after the job
  // record has been pruned.
  listAllowedRoots: async () => (appWorkDir ? [appWorkDir] : []),
  // Generations sent to a directory the user picked live outside that root, so
  // they are served by exact filename instead. Same reachability as before for
  // anything this app actually generated; a fabricated `workspaceDir` no longer
  // widens the fence.
  listServableFiles: () => jobs.listJobs().flatMap((job) => (job.assets || []).map((asset) => asset.filePath)),
});

/**
 * Handle a media file request. Returns false when the request is not ours, so
 * the caller can fall through to its normal handling.
 */
export const handleMediaHttpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: MediaRouteDeps
): Promise<boolean> => {
  let url: URL;
  try {
    url = new URL(req.url ?? '', 'http://localhost');
  } catch {
    return false;
  }
  if (url.pathname === MEDIA_JOBS_ROUTE && req.method === 'POST') {
    /**
     * Starting a generation from the browser.
     *
     * ⚠️ Unlike everything else in this file, this route *spends money* — each
     * call is a paid request to a model provider. It is reachable by anyone who
     * can reach the WebUI, exactly like the `/api/*` surface this server already
     * proxies (measured 2026-08-07: `/api/conversations` answers 200 through the
     * WebUI port with no credentials, and that surface can drive an agent). So
     * this matches the deployment's existing posture rather than opening a new
     * door — but it does mean WebUI reachability, not this route, is what has to
     * be trusted. The executor's own ceiling bounds a single call.
     */
    const input = await readJsonBody(req);
    if (!input) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return true;
    }
    const result = await deps.startJob(input as Record<string, unknown>);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result));
    return true;
  }

  if (url.pathname === MEDIA_JOB_CANCEL_ROUTE && req.method === 'POST') {
    const input = (await readJsonBody(req)) as { jobId?: string } | null;
    if (!input?.jobId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'jobId is required' }));
      return true;
    }
    const result = await deps.cancelJob(input.jobId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result));
    return true;
  }

  if (url.pathname === MEDIA_JOBS_ROUTE) {
    const body = JSON.stringify(deps.listJobs());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  if (url.pathname === MEDIA_JOBS_STREAM_ROUTE) {
    // Snapshot-plus-stream is the desktop contract too: a surface that only
    // listened would show nothing after a reload until the next progress tick,
    // and nothing at all for a job that finished while the page was closed.
    // The snapshot comes from the list route; this carries only the updates.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxies that buffer would hold events until the response ends, which
      // for a stream is never.
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const unsubscribe = deps.subscribeJobs((job) => {
      res.write(`data: ${JSON.stringify(job)}\n\n`);
    });
    // Idle streams get dropped by intermediaries; a comment costs nothing and
    // keeps the connection attributable to a live client.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const stop = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', stop);
    res.on('close', stop);
    return true;
  }

  if (url.pathname !== MEDIA_HTTP_ROUTE) return false;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return true;
  }

  const verdict = await authorizeMediaPath(url.searchParams.get('path'), deps);
  // `=== true` rather than `!verdict.ok`: this project compiles without
  // `strictNullChecks`, where TypeScript only narrows a discriminated union on
  // an explicit literal comparison. Same idiom as `resolveSelectedProvider`.
  if (verdict.ok !== true) {
    res.writeHead(verdict.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(verdict.reason);
    return true;
  }

  const mimeType = mimeTypeFor(verdict.filePath);
  const range = parseRangeHeader(req.headers.range ?? null, verdict.size);

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': String(verdict.size),
      'Accept-Ranges': 'bytes',
    });
    res.end();
    return true;
  }

  if (range) {
    // Range is what makes seeking in a <video> work; without it the element
    // downloads the whole clip before the scrubber does anything.
    res.writeHead(206, {
      'Content-Type': mimeType,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${verdict.size}`,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(verdict.filePath, { start: range.start, end: range.end }).pipe(res);
    return true;
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': String(verdict.size),
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(verdict.filePath).pipe(res);
  return true;
};
