/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import { TaskPollAdapter } from '@/common/media/adapters/taskPollAdapter';
import { resolveMediaModelSpec } from '@/common/media/catalog';
import type { MediaGenRequest } from '@/common/media/types';
import type { TProviderWithModel } from '@/common/config/storage';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const dashscopeProvider: TProviderWithModel = {
  id: 'ds',
  platform: 'openai',
  name: 'DashScope',
  base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  api_key: 'sk-ds',
  use_model: 'wanx2.1-t2i-turbo',
};

/** Build a fetch mock that walks a scripted sequence of poll states. */
function scriptedFetch(pollStates: string[], resultUrl?: string) {
  let pollIndex = 0;
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (init?.method === 'POST' && href.includes('image-synthesis')) {
      return new Response(JSON.stringify({ output: { task_id: 'task-abc', task_status: 'PENDING' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (href.includes('/api/v1/tasks/')) {
      const state = pollStates[Math.min(pollIndex, pollStates.length - 1)];
      pollIndex++;
      const output: Record<string, unknown> = { task_status: state };
      if (state === 'SUCCEEDED') output.results = [{ url: resultUrl ?? 'https://cdn.example.com/out.png' }];
      if (state === 'FAILED') output.message = 'content policy';
      return new Response(JSON.stringify({ output }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Result download
    return new Response(Buffer.from(TINY_PNG_B64, 'base64'), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  });
}

describe('TaskPollAdapter (Form C)', () => {
  const adapter = new TaskPollAdapter();
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'formc-test-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  const buildRequest = (overrides: Partial<MediaGenRequest> = {}): MediaGenRequest => {
    const spec = resolveMediaModelSpec('image', dashscopeProvider, dashscopeProvider.use_model);
    return {
      kind: 'image',
      prompt: 'a red square',
      params: { size: '1024x1024' },
      inputUris: [],
      provider: dashscopeProvider,
      // Poll fast so tests stay quick; timeout still generous.
      spec: spec ? { ...spec, polling: { intervalMs: 5, timeoutMs: 5000 } } : null,
      workspaceDir,
      ...overrides,
    };
  };

  it('submits, polls to success, downloads the result, and reports the task id', async () => {
    const fetchMock = scriptedFetch(['PENDING', 'RUNNING', 'SUCCEEDED']);
    vi.stubGlobal('fetch', fetchMock);

    const submitted: string[] = [];
    const stages: string[] = [];
    const outcome = await adapter.generate(
      buildRequest({
        onTaskSubmitted: (id) => submitted.push(id),
        onProgress: (p) => stages.push(p.stage),
      })
    );

    expect(outcome.success).toBe(true);
    expect(outcome.assets).toHaveLength(1);
    await expect(fs.promises.access(outcome.assets[0].filePath)).resolves.toBeUndefined();
    // The id must surface before polling begins so the job engine can persist it.
    expect(submitted).toEqual(['task-abc']);
    expect(stages).toContain('submitted');
    expect(stages).toContain('downloading');
  });

  it('sends the size in DashScope spelling and marks the request async', async () => {
    const fetchMock = scriptedFetch(['SUCCEEDED']);
    vi.stubGlobal('fetch', fetchMock);

    await adapter.generate(buildRequest());

    const submitCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    const init = submitCall?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.parameters.size).toBe('1024*1024');
    expect((init.headers as Record<string, string>)['X-DashScope-Async']).toBe('enable');
  });

  it('surfaces a remote failure with the vendor message', async () => {
    vi.stubGlobal('fetch', scriptedFetch(['RUNNING', 'FAILED']));

    const outcome = await adapter.generate(buildRequest());
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('content policy');
  });

  it('resumes an existing task without submitting again', async () => {
    const fetchMock = scriptedFetch(['SUCCEEDED']);
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await adapter.generate(buildRequest({ resumeTaskId: 'task-from-last-run' }));

    expect(outcome.success).toBe(true);
    const submitCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST');
    expect(submitCalls).toHaveLength(0);
    const polled = fetchMock.mock.calls.some(([url]) => String(url).includes('task-from-last-run'));
    expect(polled).toBe(true);
  });

  it('times out rather than polling forever, and reports it as a timeout', async () => {
    vi.stubGlobal('fetch', scriptedFetch(['RUNNING']));

    const spec = resolveMediaModelSpec('image', dashscopeProvider, dashscopeProvider.use_model);
    const outcome = await adapter.generate(
      buildRequest({ spec: spec ? { ...spec, polling: { intervalMs: 5, timeoutMs: 40 } } : null })
    );

    expect(outcome.success).toBe(false);
    expect(outcome.error).toBe('timeout');
    // The message must tell the agent the work may still land, so it does not
    // immediately burn another generation.
    expect(outcome.text).toMatch(/may still finish/i);
  });

  it('stops when the signal aborts', async () => {
    vi.stubGlobal('fetch', scriptedFetch(['RUNNING']));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);

    const outcome = await adapter.generate(buildRequest({ signal: controller.signal }));
    expect(outcome.success).toBe(false);
    expect(outcome.error).toBe('cancelled');
  });

  it('tolerates transient poll errors instead of discarding a paid-for task', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (init?.method === 'POST' && href.includes('image-synthesis')) {
          return new Response(JSON.stringify({ output: { task_id: 'task-abc' } }), { status: 200 });
        }
        if (href.includes('/api/v1/tasks/')) {
          calls++;
          if (calls <= 2) throw new Error('ECONNRESET');
          return new Response(
            JSON.stringify({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://cdn/x.png' }] } }),
            { status: 200 }
          );
        }
        return new Response(Buffer.from(TINY_PNG_B64, 'base64'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      })
    );

    const outcome = await adapter.generate(buildRequest());
    expect(outcome.success).toBe(true);
    expect(calls).toBeGreaterThan(2);
  });

  describe('ark-task driver endpoint derivation', () => {
    const TINY_MP4 = Buffer.from('0000001c66747970', 'hex');

    /** Mock that answers Ark submit + one succeeded poll + the video download. */
    const arkFetch = () =>
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'cgt-123' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (href.includes('/contents/generations/tasks/')) {
          return new Response(
            JSON.stringify({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/out.mp4' } }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(TINY_MP4, { status: 200, headers: { 'content-type': 'video/mp4' } });
      });

    const buildArkRequest = (provider: TProviderWithModel): MediaGenRequest => {
      const spec = resolveMediaModelSpec('video', provider, provider.use_model);
      return {
        kind: 'video',
        prompt: 'a cat surfing',
        params: {},
        inputUris: [],
        provider,
        spec: spec ? { ...spec, polling: { intervalMs: 5, timeoutMs: 5000 } } : null,
        workspaceDir,
      };
    };

    // A gateway-hosted Ark task API is configured for chat without a version
    // segment; the front proxy only routes the versioned path, so an
    // unversioned submit dies as a bare 405 that names no cause — the same
    // failure the images path hit on a real LiteLLM deployment.
    it('adds the version segment for a gateway base url', async () => {
      const fetchMock = arkFetch();
      vi.stubGlobal('fetch', fetchMock);

      const outcome = await adapter.generate(
        buildArkRequest({
          id: 'gw',
          platform: 'openai',
          name: 'Gateway',
          base_url: 'https://litellm-internal.example.com/',
          api_key: 'sk-gw',
          use_model: 'seedance-2-0-fast',
        })
      );

      expect(outcome.success).toBe(true);
      const submitUrl = String(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')?.[0]);
      expect(submitUrl).toBe('https://litellm-internal.example.com/v1/contents/generations/tasks');
    });

    // The gateway answers 200-with-empty-body when the key is not entitled to
    // the model. `response.json()` would throw a bare "Unexpected end of JSON
    // input" there, naming neither endpoint nor cause.
    it('explains an empty 200 body instead of leaking a JSON parse error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status: 200 }))
      );

      const outcome = await adapter.generate(
        buildArkRequest({
          id: 'gw',
          platform: 'openai',
          name: 'Gateway',
          base_url: 'https://litellm-internal.example.com/',
          api_key: 'sk-gw',
          use_model: 'seedance-2-0-fast',
        })
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('empty body');
      expect(outcome.error).not.toContain('JSON input');
    });

    it('leaves the vendor-native /api/v3 root untouched', async () => {
      const fetchMock = arkFetch();
      vi.stubGlobal('fetch', fetchMock);

      const outcome = await adapter.generate(
        buildArkRequest({
          id: 'ark',
          platform: 'openai',
          name: 'Ark',
          base_url: 'https://ark.cn-beijing.volces.com/api/v3',
          api_key: 'sk-ark',
          use_model: 'seedance-2-0-fast',
        })
      );

      expect(outcome.success).toBe(true);
      const submitUrl = String(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')?.[0]);
      expect(submitUrl).toBe('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
    });

    /**
     * Frame images reach the driver through `params`, not `inputUris`, and so
     * skipped the normalization every driver assumes has already happened. A
     * local path went out as the literal `url` and Ark answered
     * `content[1].image_url ... is not valid` — observed on a real request.
     */
    describe('reference normalization for frame images', () => {
      const arkVideoProvider: TProviderWithModel = {
        id: 'ark',
        platform: 'openai',
        name: 'Ark',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: 'sk-ark',
        use_model: 'doubao-seedance-2-0-fast-260128',
      };

      /** The image_url values the driver actually put on the wire. */
      const submittedImageUrls = (fetchMock: ReturnType<typeof vi.fn>): string[] => {
        const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
        if (!post) throw new Error('no submit request was made');
        const body = JSON.parse(String((post[1] as RequestInit).body)) as {
          content: Array<{ type: string; image_url?: { url: string } }>;
        };
        return body.content.filter((part) => part.type === 'image_url').map((part) => part.image_url?.url ?? '');
      };

      const runWithFrame = async (firstFrameImage: string) => {
        const fetchMock = arkFetch();
        vi.stubGlobal('fetch', fetchMock);
        const spec = resolveMediaModelSpec('video', arkVideoProvider, arkVideoProvider.use_model);
        await adapter.generate({
          kind: 'video',
          prompt: 'a kitten flying',
          params: { firstFrameImage },
          inputUris: [],
          provider: arkVideoProvider,
          spec: spec ? { ...spec, polling: { intervalMs: 5, timeoutMs: 5000 } } : null,
          workspaceDir,
        });
        return submittedImageUrls(fetchMock);
      };

      beforeEach(() => {
        fs.writeFileSync(path.join(workspaceDir, 'frame.png'), Buffer.from(TINY_PNG_B64, 'base64'));
      });

      it('inlines a workspace-relative frame image instead of sending the raw name', async () => {
        const [url] = await runWithFrame('frame.png');

        expect(url.startsWith('data:image/png;base64,')).toBe(true);
        expect(url).not.toBe('frame.png');
      });

      it('inlines an absolute frame path', async () => {
        const [url] = await runWithFrame(path.join(workspaceDir, 'frame.png'));

        expect(url.startsWith('data:image/png;base64,')).toBe(true);
      });

      /**
       * An agent handed a local path often writes a `file:` URL — the tool
       * description offers "local paths or HTTP/HTTPS URLs" and this sits
       * between them. Untranslated it was joined onto the workspace, giving
       * `…\<workspace>\file:\C:\…` and an ENOENT naming a path nobody wrote.
       */
      it('accepts a file: URL for the frame image', async () => {
        const fileUrl = pathToFileURL(path.join(workspaceDir, 'frame.png')).href;
        const [url] = await runWithFrame(fileUrl);

        expect(url.startsWith('data:image/png;base64,')).toBe(true);
      });

      it('passes an http url straight through rather than downloading it', async () => {
        const [url] = await runWithFrame('https://cdn.example.com/frame.png');

        expect(url).toBe('https://cdn.example.com/frame.png');
      });

      it('leaves an already-inlined data uri untouched', async () => {
        const dataUri = `data:image/png;base64,${TINY_PNG_B64}`;
        const [url] = await runWithFrame(dataUri);

        expect(url).toBe(dataUri);
      });
    });
  });
});
