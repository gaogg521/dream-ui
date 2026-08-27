/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form C adapter — submit, poll, download.
 *
 * Everything vendor-specific lives in a driver (taskDrivers/); this file owns
 * the parts that must behave identically everywhere: backoff, timeout,
 * cancellation, resume-after-restart, and persisting results to disk.
 */

import { downloadUrlMediaAsset, isHttpUrl, resolveLocalInputPath, saveBase64MediaAsset } from '../mediaAssets';
import type { MediaAsset, MediaGenOutcome, MediaGenParams, MediaGenRequest, MediaProviderAdapter } from '../types';
import { fallbackEndpointStyles } from '../catalog/endpointFallbacks';
import { classifyMediaFailure } from '../failureClass';
import { getTaskDriver, type TaskDriver, type TaskPollContext, type TaskSubmitContext } from './taskDrivers';
import * as fs from 'fs';
import * as path from 'path';

/** Poll interval grows from the spec's base up to this ceiling. */
const MAX_INTERVAL_MS = 15_000;
const BACKOFF_FACTOR = 1.35;
/** Consecutive transient poll errors tolerated before giving up. */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export class TaskPollAdapter implements MediaProviderAdapter {
  readonly form = 'C' as const;

  async generate(req: MediaGenRequest): Promise<MediaGenOutcome> {
    const { spec, provider, workspaceDir, signal, prompt, params, kind } = req;

    if (!spec) {
      return {
        success: false,
        assets: [],
        text: 'Error: async generation requires a catalog entry.',
        error: 'no-spec',
      };
    }
    const primaryDriver = getTaskDriver(spec.endpointStyle);
    if (!primaryDriver) {
      return {
        success: false,
        assets: [],
        text: `Error: no task driver for endpoint style "${spec.endpointStyle}".`,
        error: 'no-driver',
      };
    }

    let pollCtx: TaskPollContext = {
      kind,
      model: provider.use_model,
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      spec,
      signal,
    };

    try {
      let driver: TaskDriver = primaryDriver;
      let taskId = req.resumeTaskId;

      if (!taskId) {
        req.onProgress?.({ stage: 'preparing' });
        const inputs = await normalizeInputs(req.inputUris, workspaceDir);
        // The frame images are reference inputs too, and every driver treats
        // them as already-usable URLs — the same contract `inputs` carries. They
        // used to reach the driver exactly as the caller wrote them, so a local
        // path went out as the literal `url` and the vendor rejected it
        // (Ark: `content[1].image_url ... is not valid`). Normalizing here keeps
        // one rule for every driver instead of each re-deriving it.
        const normalizedParams = await normalizeFrameParams(params, workspaceDir);
        const submitCtx: TaskSubmitContext = { ...pollCtx, prompt, params: normalizedParams, inputs };
        const attempt = await this.submitWithFallback(primaryDriver, pollCtx, submitCtx, req);
        taskId = attempt.taskId;
        driver = attempt.driver;
        pollCtx = attempt.pollCtx;
        // Hand the id up before the first poll: a crash after submission but
        // before persistence would orphan a task the user already paid for.
        req.onTaskSubmitted?.(taskId);
        req.onProgress?.({ stage: 'submitted', taskId });
      } else {
        req.onProgress?.({ stage: 'running', taskId, message: 'resumed after restart' });
      }

      const items = await this.pollUntilDone(driver, pollCtx, taskId, req);

      req.onProgress?.({ stage: 'downloading', taskId });
      const assets: MediaAsset[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.b64) assets.push(await saveBase64MediaAsset(kind, item.b64, workspaceDir, i));
        else if (item.url) assets.push(await downloadUrlMediaAsset(kind, item.url, workspaceDir, i, item.headers));
      }

      if (assets.length === 0) {
        return {
          success: false,
          assets: [],
          text: 'Task succeeded but produced no downloadable result.',
          error: 'empty-result',
        };
      }

      req.onProgress?.({ stage: 'saving', taskId });
      return { success: true, assets, text: `${kind === 'video' ? 'Video' : 'Image'} generated successfully.` };
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        return { success: false, assets: [], text: 'Generation was cancelled.', error: 'cancelled' };
      }
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout = message === 'timeout';
      return {
        success: false,
        assets: [],
        text: isTimeout
          ? `Generation timed out after ${Math.round((spec.polling?.timeoutMs ?? 0) / 1000)}s. The remote task may still finish; check the job status later.`
          : `Error generating ${kind}: ${message}`,
        error: isTimeout ? 'timeout' : message,
      };
    }
  }

  /**
   * Submit, and when the configured protocol turns out not to be served at this
   * host, try its sibling before giving up.
   *
   * Why this lives in the executor rather than in the catalog: the catalog
   * matches Seedance on the model name alone and resolves it to Ark's native
   * task API, on purpose — pinning it to a host would write one deployment's
   * address into the product. That leaves the same model behind a relay gateway
   * resolving to an API the gateway does not proxy, and the only recovery was
   * for the user to know to pick the gateway protocol by hand. A submission is
   * the one moment we can find out for free which protocol this host actually
   * speaks, so that is where the question gets settled.
   *
   * Only `notRouted` triggers it. Every other class of failure means the path
   * WAS routed and the request itself was refused (bad key, unknown model,
   * quota, content policy) — retrying that under a different protocol would
   * turn one honest error into two misleading ones.
   *
   * A fallback that succeeds also replaces the poll context: the task id was
   * issued by the sibling protocol, and polling it with the configured one
   * would look up an id that host never heard of.
   */
  private async submitWithFallback(
    primaryDriver: TaskDriver,
    pollCtx: TaskPollContext,
    submitCtx: TaskSubmitContext,
    req: MediaGenRequest
  ): Promise<{ taskId: string; driver: TaskDriver; pollCtx: TaskPollContext }> {
    try {
      const submitted = await primaryDriver.submit(submitCtx);
      return { taskId: submitted.taskId, driver: primaryDriver, pollCtx };
    } catch (error) {
      if (isAbortError(error) || req.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (classifyMediaFailure(message) !== 'notRouted') throw error;

      const tried: string[] = [];
      for (const style of fallbackEndpointStyles(pollCtx.spec.endpointStyle)) {
        const driver = getTaskDriver(style);
        if (!driver) continue;
        const spec = { ...pollCtx.spec, endpointStyle: style };
        try {
          const submitted = await driver.submit({ ...submitCtx, spec });
          // Report before returning: the job engine persists the discovery, and
          // without it every later generation would pay for this same probe.
          req.onEndpointStyleSwitched?.(style);
          return { taskId: submitted.taskId, driver, pollCtx: { ...pollCtx, spec } };
        } catch (fallbackError) {
          if (isAbortError(fallbackError) || req.signal?.aborted) throw fallbackError;
          tried.push(style);
        }
      }

      // Nothing to fall back to, or every sibling answered the same way. The
      // original error is the one to report — it names the protocol the user
      // configured — with the attempts appended so the advice line that follows
      // ("go change the endpoint") is not read as an untried suggestion.
      if (tried.length === 0) throw error;
      throw new Error(`${message} Automatically retried under ${tried.join(', ')}, with the same result.`, {
        cause: error,
      });
    }
  }

  private async pollUntilDone(
    driver: NonNullable<ReturnType<typeof getTaskDriver>>,
    ctx: TaskPollContext,
    taskId: string,
    req: MediaGenRequest
  ) {
    // Read off the context, not `req`: after a protocol fallback the effective
    // spec is the one in `ctx`.
    const intervalBase = ctx.spec.polling?.intervalMs ?? 3000;
    const timeoutMs = ctx.spec.polling?.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;

    let interval = intervalBase;
    let consecutiveErrors = 0;

    for (;;) {
      if (req.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (Date.now() > deadline) {
        // Best-effort remote cancel so the vendor stops billing a task nobody
        // is waiting for any more.
        await driver.cancel?.(ctx, taskId).catch(() => {
          // Best effort — we are failing the job regardless.
        });
        throw new Error('timeout');
      }

      await sleep(interval, req.signal);

      let result;
      try {
        result = await driver.poll(ctx, taskId);
        consecutiveErrors = 0;
      } catch (error) {
        if (isAbortError(error)) throw error;
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw error;
        // A transient network blip must not discard a task already paid for.
        interval = Math.min(MAX_INTERVAL_MS, Math.round(interval * BACKOFF_FACTOR));
        continue;
      }

      switch (result.state) {
        case 'succeeded':
          return result.items;
        case 'failed':
          throw new Error(result.error);
        case 'running':
          req.onProgress?.({ stage: 'running', taskId, percent: result.percent });
          break;
        case 'pending':
          req.onProgress?.({ stage: 'queued', taskId });
          break;
      }

      interval = Math.min(MAX_INTERVAL_MS, Math.round(interval * BACKOFF_FACTOR));
    }
  }
}

/**
 * Task APIs fetch conditioning images by URL server-side, so local files have
 * to travel as data URLs.
 */
/**
 * `file:` URL → local path, without `node:url`.
 *
 * This module is under `common/` and so is bundled for the renderer as well as
 * the main process; importing `node:url` here compiles fine but throws on
 * evaluation in the browser ("Module has been externalized"), taking the whole
 * module graph — and with it the entire UI — down at startup. Type-checking
 * cannot see that, which is exactly why the process boundary is a rule rather
 * than a preference.
 *
 * Handles the two shapes that reach us: `file:///C:/x/y.png` (Windows, drive
 * letter after the leading slash) and `file:///home/u/y.png` (POSIX).
 */
function filePathFromFileUrl(uri: string): string {
  const withoutScheme = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  // A Windows path arrives as `/C:/…`; the leading slash is part of the URL
  // grammar, not the path.
  return /^\/[a-zA-Z]:/.test(withoutScheme) ? withoutScheme.slice(1) : withoutScheme;
}

/**
 * Turn one reference into something a vendor will accept.
 *
 * HTTP URLs and data URIs pass through; anything else is read off disk and
 * inlined. `file:` is handled explicitly because an agent handed a local path
 * will often write one — it sits exactly between the "local path" and "URL" the
 * tool description offers — and without this it was treated as a relative path
 * and joined onto the workspace, producing `…\<workspace>\file:\C:\…` and an
 * ENOENT that names a path nobody ever wrote.
 */
async function normalizeReference(uri: string, workspaceDir: string): Promise<string> {
  if (isHttpUrl(uri) || uri.startsWith('data:')) return uri;
  const local = uri.startsWith('file:') ? filePathFromFileUrl(uri) : uri;
  const fullPath = await resolveLocalInputPath(local, workspaceDir);
  const buffer = await fs.promises.readFile(fullPath);
  const ext = path.extname(fullPath).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function normalizeInputs(inputUris: string[], workspaceDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const uri of inputUris) {
    out.push(await normalizeReference(uri, workspaceDir));
  }
  return out;
}

/**
 * Same treatment for the first/last frame images, which reach the driver
 * through `params` rather than `inputUris` and so missed it entirely.
 */
async function normalizeFrameParams(params: MediaGenParams, workspaceDir: string): Promise<MediaGenParams> {
  const next = { ...params };
  if (next.firstFrameImage) next.firstFrameImage = await normalizeReference(next.firstFrameImage, workspaceDir);
  if (next.lastFrameImage) next.lastFrameImage = await normalizeReference(next.lastFrameImage, workspaceDir);
  return next;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted');
}
