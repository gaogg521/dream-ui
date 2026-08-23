/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end through the real wire protocol: a TCP client speaking the same
 * frames as the MCP shell → main-process media service → job engine → Form C
 * driver → asset on disk.
 *
 * Only two things are faked: the backend HTTP the service reads provider config
 * from, and the vendor task API. Everything between is the real code path.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { httpRequestMock, configDir } = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  configDir: { path: '' },
}));

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: httpRequestMock }));
vi.mock('@process/utils/utils', () => ({ getConfigPath: () => configDir.path }));

const { startMediaMcpServer, stopMediaMcpServer } = await import('@process/services/mediaJob');

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const provider = {
  id: 'ds-provider',
  platform: 'openai',
  name: 'DashScope',
  base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api_key: 'sk-secret',
  models: ['wanx2.1-t2i-turbo'],
  enabled: true,
};

/** Speak the real framed protocol and collect every frame until the socket ends. */
function callMediaService(port: number, request: unknown): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const frames: Array<Record<string, unknown>> = [];
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      const body = Buffer.from(JSON.stringify(request), 'utf-8');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    });
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (buffer.length < 4 + len) break;
        const json = buffer.subarray(4, 4 + len).toString('utf-8');
        buffer = buffer.subarray(4 + len);
        try {
          frames.push(JSON.parse(json));
        } catch {
          // ignore
        }
      }
    });
    socket.on('end', () => resolve(frames));
    socket.on('error', reject);
    setTimeout(() => reject(new Error('media service call timed out')), 15000);
  });
}

describe('media MCP TCP service (integration)', () => {
  let port: number;
  let workspaceDir: string;

  beforeAll(async () => {
    configDir.path = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-cfg-'));
    port = await startMediaMcpServer();
  });

  afterAll(async () => {
    await stopMediaMcpServer();
    // `force` does not help against ENOTEMPTY: on Windows the job store's last
    // atomic rename can still be settling when the directory is removed, so the
    // rmdir races a file that reappears. Retrying is what makes this teardown
    // deterministic — without it the suite fails intermittently while all four
    // tests pass.
    await fs.promises.rm(configDir.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    httpRequestMock.mockReset();
    if (workspaceDir) await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  const primeBackendWith = (selection: unknown, providers: unknown[] = [provider]) => {
    httpRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url === '/api/providers') return providers;
      if (url === '/api/settings/client') return { 'tools.imageGenerationModel': selection };
      return undefined;
    });
  };

  /** A provider offering nothing that can generate media. */
  const chatOnlyProvider = { ...provider, id: 'chat-only', models: ['gpt-4o-mini'] };

  const primeBackend = () => primeBackendWith({ id: provider.id, use_model: 'wanx2.1-t2i-turbo' });

  const stubDashScope = (states: string[]) => {
    let pollIndex = 0;
    const seenAuth: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (auth) seenAuth.push(auth);
      if (init?.method === 'POST' && href.includes('image-synthesis')) {
        return new Response(JSON.stringify({ output: { task_id: 'task-e2e' } }), { status: 200 });
      }
      if (href.includes('/api/v1/tasks/')) {
        const state = states[Math.min(pollIndex, states.length - 1)];
        pollIndex++;
        const output: Record<string, unknown> =
          state === 'SUCCEEDED'
            ? { task_status: 'SUCCEEDED', results: [{ url: 'https://cdn.example.com/wanx.png' }] }
            : { task_status: state };
        return new Response(JSON.stringify({ output }), { status: 200 });
      }
      return new Response(Buffer.from(TINY_PNG_B64, 'base64'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, seenAuth };
  };

  it('runs a Form C generation end to end and saves the asset', async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-ws-'));
    primeBackend();
    const { seenAuth } = stubDashScope(['PENDING', 'SUCCEEDED']);

    const frames = await callMediaService(port, {
      op: 'generate',
      kind: 'image',
      prompt: 'a red panda',
      params: { size: '1024x1024' },
      workspaceDir,
    });

    const result = frames.find((frame) => frame.type === 'result') as
      | { success: boolean; job?: { status: string; assets?: Array<{ filePath: string }>; jobId: string } }
      | undefined;

    expect(result?.success).toBe(true);
    expect(result?.job?.status).toBe('done');

    const assetPath = result?.job?.assets?.[0]?.filePath;
    expect(assetPath).toBeTruthy();
    await expect(fs.promises.access(assetPath!)).resolves.toBeUndefined();

    // Credentials are resolved in the main process, never shipped to the caller.
    expect(seenAuth).toContain('Bearer sk-secret');
    expect(JSON.stringify(frames)).not.toContain('sk-secret');

    // Progress frames keep the socket alive during a long generation.
    expect(frames.some((frame) => frame.type === 'progress')).toBe(true);
  });

  /**
   * "Nothing configured" now means no media model anywhere — not merely an
   * empty Settings > Tools choice. A model declared on a provider is a valid
   * way to configure media generation, so this case has to withhold both.
   */
  it('reports a clear error when no model is configured instead of hanging', async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-ws-'));
    primeBackendWith(undefined, [chatOnlyProvider]);

    const frames = await callMediaService(port, {
      op: 'generate',
      kind: 'image',
      prompt: 'anything',
      workspaceDir,
    });

    const result = frames.at(-1) as { success: boolean; error?: string };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no image generation model is configured/i);
  });

  /**
   * The gap this closed: an agent calling the tool read only
   * `tools.imageGenerationModel`, so a user who declared a model as an image
   * model — the way the product asks for it — was told none was configured.
   * The send box never hit this, because it passes its model explicitly.
   */
  it('falls back to a declared media model when Settings > Tools has no pick', async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-ws-'));
    primeBackendWith(undefined);
    stubDashScope(['SUCCEEDED']);

    const frames = await callMediaService(port, {
      op: 'generate',
      kind: 'image',
      prompt: 'a cat',
      workspaceDir,
    });

    const result = frames.at(-1) as { success: boolean; error?: string };
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('exposes finished jobs through the status op', async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-ws-'));
    primeBackend();
    stubDashScope(['SUCCEEDED']);

    const generated = await callMediaService(port, {
      op: 'generate',
      kind: 'image',
      prompt: 'a blue square',
      workspaceDir,
    });
    const jobId = (generated.at(-1) as { job?: { jobId: string } }).job?.jobId;
    expect(jobId).toBeTruthy();

    const status = await callMediaService(port, { op: 'status', jobId });
    const frame = status.at(-1) as { success: boolean; job?: { status: string } };
    expect(frame.success).toBe(true);
    expect(frame.job?.status).toBe('done');
  });

  it('persists jobs to disk so a restart can pick them up', async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-ws-'));
    primeBackend();
    stubDashScope(['SUCCEEDED']);

    await callMediaService(port, { op: 'generate', kind: 'image', prompt: 'persisted', workspaceDir });

    const stored = JSON.parse(await fs.promises.readFile(path.join(configDir.path, 'media-jobs.json'), 'utf-8'));
    expect(stored.jobs.length).toBeGreaterThan(0);
    // The credential must never reach the job file.
    expect(JSON.stringify(stored)).not.toContain('sk-secret');
  });
});
