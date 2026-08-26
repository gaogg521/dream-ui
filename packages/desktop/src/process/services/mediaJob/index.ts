/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-process media generation service: owns the job engine and the TCP
 * endpoint the built-in MCP shell talks to.
 *
 * Protocol mirrors the other built-in MCP bridges (teamKnowledge / exportPdf):
 * 4-byte big-endian length header + UTF-8 JSON body. Unlike those, a media
 * connection stays open for the life of the request and may carry several
 * progress frames before the final result — video generation runs for minutes
 * and a silent socket looks indistinguishable from a hang.
 *
 * Credentials never travel to the subprocess: the shell only knows a port, and
 * this service resolves the provider (and its api_key) from the backend at
 * execution time.
 */

import fs from 'fs';
import net from 'net';
import path from 'path';
import { isHttpUrl, isWithin, resolveLocalInputPathAllowingTemp } from '@/common/media/mediaAssets';
import { httpRequest } from '@/common/adapter/httpBridge';
import type { ImageGenerationModelSetting } from '@/common/config/clientSettings';
import {
  resolveImageGenerationMcpEnv,
  type ImageGenerationMcpEnvResolveResult,
} from '@/common/config/imageGenerationMcpEnv';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { executeMediaGeneration } from '@/common/media';
import { applyCatalogOverridesJson, resolveMediaModelSpec } from '@/common/media/catalog';
import { findDeclaredMediaModel } from '@/common/media/declaredModel';
import { meterMediaJob } from '@/common/media/pricing';
import type { MediaKind } from '@/common/media/types';
import { getConfigPath } from '@process/utils/utils';
import { MediaJobManager } from './jobManager';
import { MediaJobStore } from './store';
import { checkMediaPolicy, reportMediaAsset, reportMediaUsage } from './governance';
import { toMediaJobView, type MediaJobSnapshot } from './types';
import { ipcBridge } from '@/common';

const START_PORT = 19860;
const MAX_PORT_ATTEMPTS = 10;

/** Client-settings key per media kind. */
const SETTING_KEY: Record<MediaKind, string> = {
  image: 'tools.imageGenerationModel',
  video: 'tools.videoGenerationModel',
};

type GenerateRequest = {
  op?: 'generate';
  kind?: MediaKind;
  prompt?: string;
  params?: Record<string, unknown>;
  inputUris?: string[];
  workspaceDir?: string;
  /**
   * Which conversation this generation belongs to, when the MCP shell was told
   * (see `DREAM_MEDIA_CONVERSATION_ID`). Attribution only — it is what lets a
   * company trace a media charge back to where it happened.
   */
  conversationId?: string;
};

type StatusRequest = {
  op: 'status';
  jobId?: string;
};

type CancelRequest = {
  op: 'cancel';
  jobId: string;
};

type IncomingRequest = GenerateRequest | StatusRequest | CancelRequest;

let server: net.Server | null = null;
let currentPort = 0;
let manager: MediaJobManager | null = null;

// ===== provider resolution =====

async function fetchProviders(): Promise<IProvider[]> {
  try {
    const providers = await httpRequest('GET', '/api/providers');
    return Array.isArray(providers) ? (providers as IProvider[]) : [];
  } catch {
    return [];
  }
}

/**
 * Install the user's catalog entries for this process.
 *
 * The main process must agree with the renderer about what is selectable —
 * offering a model the executor cannot resolve is exactly the drift the catalog
 * exists to prevent — so both install from this same stored setting.
 */
async function loadCatalogOverrides(): Promise<void> {
  try {
    const settings = (await httpRequest('GET', '/api/settings/client')) as Record<string, unknown> | undefined;
    const raw = settings?.['tools.mediaCatalogOverrides'];
    applyCatalogOverridesJson(typeof raw === 'string' ? raw : '');
  } catch {
    // Unreadable settings must not take media generation down; the built-in
    // catalog still resolves everything it always did.
  }
}

async function fetchSelection(kind: MediaKind): Promise<ImageGenerationModelSetting | undefined> {
  try {
    const settings = (await httpRequest('GET', '/api/settings/client')) as
      | Record<string, ImageGenerationModelSetting | undefined>
      | undefined;
    return settings?.[SETTING_KEY[kind]];
  } catch {
    return undefined;
  }
}

/**
 * Resolve the provider (with credentials) for a job. Re-resolved on every run
 * so a rotated key or a re-pointed provider is picked up by recovered jobs.
 */
async function resolveProvider(providerId: string, model: string): Promise<TProviderWithModel | null> {
  const providers = await fetchProviders();
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return null;
  const { models: _models, ...rest } = provider;
  return { ...rest, use_model: model };
}

/**
 * Resolve the currently selected provider+model for a kind.
 *
 * Returns one shape with optional fields rather than a discriminated union:
 * this project compiles without `strictNullChecks`, where narrowing a union by
 * a negated boolean discriminant does not work.
 */
type SelectedProvider = { provider?: TProviderWithModel; error?: string };

// `=== true` rather than truthiness: without `strictNullChecks` TypeScript only
// narrows a discriminated union on an explicit literal comparison. Same idiom as
// `logImageGenerationEnvResolution` in runBackendMigrations.
function describeResolutionFailure(result: ImageGenerationMcpEnvResolveResult): string {
  if (result.ok === true) return '';
  return result.message;
}

async function resolveSelectedProvider(kind: MediaKind, explicitModel?: string): Promise<SelectedProvider> {
  const [stored, providers] = await Promise.all([fetchSelection(kind), fetchProviders()]);

  // An explicitly requested model overrides the global setting. Only the direct
  // renderer path can ask for one, which is what makes a per-conversation model
  // choice possible without the MCP layer needing caller identity.
  let selection = stored;
  if (explicitModel) {
    const owner = providers.find((provider) => provider.models?.includes(explicitModel));
    if (!owner) {
      return { error: `No configured provider offers the model "${explicitModel}".` };
    }
    selection = {
      id: owner.id,
      name: owner.name,
      platform: owner.platform,
      base_url: '',
      api_key: '',
      use_model: explicitModel,
    };
  }

  if (!selection) {
    selection = findDeclaredMediaModel(kind, providers);
  }

  if (!selection) {
    return {
      error: `No ${kind} generation model is configured. Declare one as a ${kind} model in Settings > Models, or pick one in Settings > Tools.`,
    };
  }
  const resolution = resolveImageGenerationMcpEnv(selection, providers);
  if (resolution.ok) {
    const { models: _models, ...rest } = resolution.provider;
    return { provider: { ...rest, use_model: resolution.model } };
  }
  return { error: `${kind} generation model is not usable: ${describeResolutionFailure(resolution)}` };
}

// ===== engine =====

function getManager(): MediaJobManager {
  if (manager) return manager;
  const store = new MediaJobStore(path.join(getConfigPath(), 'media-jobs.json'));
  manager = new MediaJobManager({
    resolveProvider,
    loadJobs: () => store.load(),
    saveJobs: (jobs) => store.save(jobs),
    execute: async ({ job, provider, signal, onProgress, onTaskSubmitted, resumeTaskId }) =>
      executeMediaGeneration({
        kind: job.kind,
        prompt: job.prompt,
        params: job.params,
        inputUris: job.inputUris,
        provider,
        workspaceDir: job.workspaceDir,
        signal,
        onProgress,
        onTaskSubmitted,
        resumeTaskId,
      }),
  });
  manager.onJobUpdate((job) => {
    void reportJobUsage(job).catch(() => {
      // Best effort: the media is already produced and saved; a bookkeeping
      // failure must not surface as a failed generation.
    });
  });
  return manager;
}

/**
 * Jobs already reported to the usage ledger.
 *
 * Reporting is attached to the engine rather than to a caller so that no entry
 * point can forget it — the renderer path would otherwise have silently escaped
 * the company rollup that the MCP path honours. The set guards against a
 * terminal state being broadcast more than once; double-reporting would inflate
 * a company's spend against its own cap.
 */
const reportedJobs = new Set<string>();

async function reportJobUsage(job: MediaJobSnapshot): Promise<void> {
  if (job.status !== 'done' || !job.assets?.length || reportedJobs.has(job.id)) return;
  reportedJobs.add(job.id);
  const provider = await resolveProvider(job.providerId, job.model);
  // Metered on what was actually produced, not what was asked for: a job that
  // returns two of four requested images should cost two. Shared with the
  // renderer's cost display, so the figure shown on the card is by construction
  // the figure this reports — two implementations would drift and the user
  // would be the one to notice, against an invoice.
  const units = meterMediaJob(job);
  await reportMediaUsage(
    job.kind,
    job.model,
    units.count,
    units.durationSeconds,
    provider?.model_settings?.[job.model]?.media_unit_price_usd,
    // Without this the ledger row says only "someone spent this". The agent
    // audit sees tool calls, so an agent-driven generation is traceable there —
    // but one started straight from the compose box writes no message at all
    // and would otherwise be attributable to nothing. The conversation id is
    // the one identifier both surfaces share.
    job.origin?.conversationId
  );
  // T8: one ledger row per produced FILE, not per job — each asset must be
  // individually findable. Additive to the cost report above, never gates or
  // blocks it; a ledger-bookkeeping failure must not read as a failed spend
  // report either (each call is independently best-effort, see governance.ts).
  await Promise.all(
    job.assets.map((asset) =>
      reportMediaAsset(job.kind, job.model, asset.filePath, job.prompt, job.origin?.conversationId)
    )
  );
}

/** Public accessor so other main-process code (IPC bridge) can observe jobs. */
export function getMediaJobManager(): MediaJobManager {
  return getManager();
}

// ===== TCP framing =====

function writeTcpMessage(socket: net.Socket, data: unknown): void {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(data), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function createTcpMessageReader(onMessage: (msg: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const bodyLen = buffer.readUInt32BE(0);
      if (buffer.length < 4 + bodyLen) break;
      const jsonStr = buffer.subarray(4, 4 + bodyLen).toString('utf-8');
      buffer = buffer.subarray(4 + bodyLen);
      try {
        onMessage(JSON.parse(jsonStr));
      } catch {
        // Malformed JSON — skip
      }
    }
  };
}

// ===== job creation (shared by the MCP socket and the renderer) =====

export type StartMediaJobInput = {
  kind: MediaKind;
  prompt: string;
  params?: Record<string, unknown>;
  inputUris?: string[];
  workspaceDir?: string;
  /**
   * Model chosen for this request. Only the direct (renderer) path can supply
   * one — an MCP tool call carries no caller identity, so it always falls back
   * to the global setting.
   */
  model?: string;
  /** Conversation this belongs to, when the caller knows it. */
  conversationId?: string;
};

export type StartMediaJobResult = { job?: MediaJobSnapshot; error?: string };

/**
 * Validate, apply policy, and enqueue — the single entry point for starting a
 * media job.
 *
 * Both callers funnel through here on purpose: the company policy gate and the
 * catalog refresh must not be things a new entry point can forget to do.
 */
/**
 * Where a job writes when the caller named no workspace.
 *
 * `process.cwd()` used to be the fallback and it is never somewhere a user
 * would look: in dev it is the repo root, and in a packaged app it is wherever
 * the executable happened to be launched from. The app's own work directory is
 * where every other generated artefact already lives.
 *
 * Resolved lazily rather than by a top-level import: `initStorage` drags the
 * whole settings/bridge graph in with it, and this module is loaded by the MCP
 * server tests that mock only part of that graph.
 */
/**
 * Keep a copy of every reference image next to the result it produced.
 *
 * An uploaded reference lands in the OS temp directory
 * (`…/Temp/dream/<conversation>/…`), which Windows Disk Cleanup and its
 * equivalents delete on their own schedule. The job outlives it: the card shows
 * that image as "what this was made from", and Regenerate feeds the same path
 * back. Once temp is swept both quietly break, at a moment unrelated to
 * anything the user did.
 *
 * Copying is deliberate rather than referencing: the workspace is where every
 * other artefact of this conversation lives, and a reference that only exists
 * somewhere volatile is not really part of the record.
 *
 * HTTP URLs are left alone (nothing local to lose), as is anything already
 * inside the workspace. A copy that fails is not fatal — the original path
 * still works today — so the job proceeds with what the caller gave us.
 */
export async function persistReferenceInputs(inputUris: string[], workspaceDir: string): Promise<string[]> {
  if (inputUris.length === 0) return inputUris;

  const refsDir = path.join(workspaceDir, 'refs');
  const out: string[] = [];

  for (const [index, uri] of inputUris.entries()) {
    if (!uri || isHttpUrl(uri) || uri.startsWith('data:')) {
      out.push(uri);
      continue;
    }
    try {
      // Agent tool-call args can be prompt-injection-controlled, so this
      // helper only ever resolves a reference to the workspace or the fixed
      // OS temp root (`resolveLocalInputPathAllowingTemp`) — never to an
      // arbitrary absolute path elsewhere on disk (see the comment above
      // `resolveSafePath` in mediaAssets.ts). Downstream adapters are
      // stricter still: they accept workspace-only, so anything rescued here
      // must actually be copied in, not just validated.
      const source = await resolveLocalInputPathAllowingTemp(uri, workspaceDir);
      if (isWithin(workspaceDir, source)) {
        // Already inside the workspace — nothing to rescue.
        out.push(uri);
        continue;
      }
      await fs.promises.mkdir(refsDir, { recursive: true });
      // The index is what actually keeps two references apart. `Date.now()` alone
      // collides whenever same-named files are copied inside the same
      // millisecond — the second copyFile then overwrites the first and BOTH
      // entries point at one file, so the model silently receives the same
      // reference image twice. Slow machines hide it; CI reproduces it.
      const target = path.join(refsDir, `${Date.now()}-${index}-${path.basename(source)}`);
      await fs.promises.copyFile(source, target);
      out.push(target);
    } catch {
      // Keep the caller's path: the downstream adapter enforces the same
      // workspace boundary and will reject it with a clear error, rather
      // than this helper failing the whole generation over bookkeeping.
      out.push(uri);
    }
  }

  return out;
}

const fallbackWorkspaceDir = (): string => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSystemDir } = require('@process/utils/initStorage') as {
      getSystemDir: () => { workDir: string };
    };
    const workDir = getSystemDir()?.workDir;
    if (workDir) return workDir;
  } catch {
    // Fall through — a missing work dir must not stop a generation.
  }
  return process.cwd();
};

export async function startMediaJob(input: StartMediaJobInput): Promise<StartMediaJobResult> {
  const kind: MediaKind = input.kind === 'video' ? 'video' : 'image';
  const prompt = (input.prompt ?? '').trim();
  if (!prompt) return { error: 'prompt is required' };

  // Refreshed per request rather than cached at startup: the user edits catalog
  // declarations in settings and must not have to restart the app to use a
  // model they just described. One local settings read is free next to a
  // generation that takes seconds to minutes.
  await loadCatalogOverrides();

  const resolved = await resolveSelectedProvider(kind, input.model);
  const provider = resolved.provider;
  if (!provider) return { error: resolved.error };

  // Company policy is checked before the job exists, so a blocked request never
  // becomes a queued job. Recovered jobs deliberately skip this: their remote
  // task was already submitted and paid for, and refusing to collect a result
  // that is already being billed helps nobody.
  const policy = await checkMediaPolicy(kind, provider.use_model);
  if (!policy.allow) return { error: policy.reason };

  // `process.cwd()` was the old fallback and it is never a place a user would
  // look: in dev it is the repo root, and in a packaged app it is wherever the
  // executable happened to be launched from — possibly Program Files. Fall back
  // to the app's own work directory instead, which is where every other
  // generated artefact lives.
  const workspaceDir = input.workspaceDir?.trim() || fallbackWorkspaceDir();
  const spec = resolveMediaModelSpec(kind, provider, provider.use_model);
  const inputUris = await persistReferenceInputs(input.inputUris ?? [], workspaceDir);

  return {
    job: getManager().create({
      kind,
      prompt,
      params: (input.params ?? {}) as never,
      inputUris,
      providerId: provider.id,
      model: provider.use_model,
      specId: spec?.id,
      workspaceDir,
      // Attribution travels with the job so a surface can decide whether it
      // owns it. The renderer knows its conversation; MCP callers do not.
      origin: { workspaceDir, conversationId: input.conversationId },
    }),
  };
}

// ===== request handling =====

async function handleGenerate(socket: net.Socket, req: GenerateRequest): Promise<void> {
  const started = await startMediaJob({
    kind: req.kind === 'video' ? 'video' : 'image',
    prompt: req.prompt ?? '',
    params: req.params,
    inputUris: req.inputUris,
    workspaceDir: req.workspaceDir,
    conversationId: req.conversationId,
  });
  if (!started.job) {
    writeTcpMessage(socket, { type: 'result', success: false, error: started.error });
    return;
  }
  const job = started.job;
  const engine = getManager();

  // Stream progress while the job runs so a long video generation does not look
  // like a dead socket to the MCP client.
  const unsubscribe = engine.onJobUpdate((updated: MediaJobSnapshot) => {
    if (updated.id !== job.id) return;
    writeTcpMessage(socket, { type: 'progress', job: toMediaJobView(updated) });
  });

  try {
    const finished = await engine.waitForCompletion(job.id);
    writeTcpMessage(socket, {
      type: 'result',
      success: finished.status === 'done',
      job: toMediaJobView(finished),
    });
  } finally {
    unsubscribe();
  }
}

function handleStatus(socket: net.Socket, req: StatusRequest): void {
  const engine = getManager();
  if (req.jobId) {
    const job = engine.getJob(req.jobId);
    writeTcpMessage(
      socket,
      job
        ? { type: 'result', success: true, job: toMediaJobView(job) }
        : { type: 'result', success: false, error: `Unknown job: ${req.jobId}` }
    );
    return;
  }
  writeTcpMessage(socket, {
    type: 'result',
    success: true,
    jobs: engine.listJobs().slice(0, 20).map(toMediaJobView),
  });
}

function handleCancel(socket: net.Socket, req: CancelRequest): void {
  const cancelled = getManager().cancel(req.jobId);
  writeTcpMessage(socket, {
    type: 'result',
    success: cancelled,
    ...(cancelled ? {} : { error: `Job ${req.jobId} is not running` }),
  });
}

function handleConnection(socket: net.Socket): void {
  const reader = createTcpMessageReader((msg) => {
    const req = (msg ?? {}) as IncomingRequest;
    const done = () => socket.end();
    const fail = (err: unknown) => {
      writeTcpMessage(socket, {
        type: 'result',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      socket.end();
    };

    switch (req.op) {
      case 'status':
        try {
          handleStatus(socket, req);
          done();
        } catch (err) {
          fail(err);
        }
        return;
      case 'cancel':
        try {
          handleCancel(socket, req);
          done();
        } catch (err) {
          fail(err);
        }
        return;
      default:
        handleGenerate(socket, req as GenerateRequest).then(done, fail);
    }
  });

  socket.on('data', reader);
  socket.on('error', () => {
    // Client disconnect — the job keeps running on purpose.
  });
  // No socket timeout: a video job legitimately outlives any fixed window, and
  // the job engine owns the real deadline.
  socket.setTimeout(0);
}

// ===== lifecycle =====

function listenOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tryServer = net.createServer(handleConnection);
    tryServer.once('error', () => resolve(false));
    tryServer.listen(port, '127.0.0.1', () => {
      server = tryServer;
      currentPort = port;
      resolve(true);
    });
  });
}

export async function startMediaMcpServer(): Promise<number> {
  if (server) return currentPort;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const ok = await listenOnPort(START_PORT + i);
    if (ok) {
      const port = START_PORT + i;
      console.log(`[mediaMcpServer] Listening on 127.0.0.1:${port}`);
      // Pick up anything that was in flight when the app last closed. A task
      // already submitted upstream has been paid for; dropping it would be a
      // silent loss the user cannot recover.
      getManager()
        .restore()
        .then(({ resumed, failed }) => {
          if (resumed || failed) {
            console.log(`[mediaMcpServer] restored media jobs — resumed: ${resumed}, failed: ${failed}`);
          }
        })
        .catch((error) => console.warn('[mediaMcpServer] job restore failed:', error));
      return port;
    }
  }
  throw new Error(`[mediaMcpServer] No available port in range ${START_PORT}-${START_PORT + MAX_PORT_ATTEMPTS - 1}`);
}

export function getMediaMcpPort(): number {
  return currentPort;
}

export async function stopMediaMcpServer(): Promise<void> {
  manager?.shutdown();
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => {
      server = null;
      currentPort = 0;
      resolve();
    });
  });
}
