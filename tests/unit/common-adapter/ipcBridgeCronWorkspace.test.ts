/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type HttpCall = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
};

const httpBridgeMocks = vi.hoisted(() => {
  const calls: HttpCall[] = [];
  let response: unknown = true;
  const provider =
    (method: HttpCall['method']) =>
    <Data, Params = undefined>(path: string | ((params: Params) => string), mapBody?: (params: Params) => unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async (params?: Params) => {
        const resolvedPath = typeof path === 'function' ? path(params as Params) : path;
        calls.push({
          method,
          path: resolvedPath,
          body: mapBody && params !== undefined ? mapBody(params as Params) : undefined,
        });
        return response as Data;
      }),
    });
  const emitter = () => ({ on: vi.fn(() => vi.fn()), emit: vi.fn() });

  return {
    calls,
    setResponse: (value: unknown) => {
      response = value;
    },
    httpGet: provider('GET'),
    httpPost: provider('POST'),
    httpPut: provider('PUT'),
    httpPatch: provider('PATCH'),
    httpDelete: provider('DELETE'),
    httpGetLocal: provider('GET'),
    httpPostLocal: provider('POST'),
    httpPutLocal: provider('PUT'),
    httpPatchLocal: provider('PATCH'),
    httpDeleteLocal: provider('DELETE'),
    httpRequest: vi.fn(),
    stubProvider: vi.fn((name: string, defaultValue: unknown) => ({
      provider: vi.fn(),
      invoke: vi.fn(async () => defaultValue),
    })),
    withResponseMap: vi.fn(
      (
        inner: { provider: unknown; invoke: (params?: unknown) => Promise<unknown> },
        map: (raw: unknown) => unknown
      ) => ({
        provider: inner.provider,
        invoke: vi.fn(async (params?: unknown) => map(await inner.invoke(params))),
      })
    ),
    wsEmitter: vi.fn(emitter),
    wsMappedEmitter: vi.fn(emitter),
    stubEmitter: vi.fn(emitter),
  };
});

vi.mock('@/common/adapter/httpBridge', () => httpBridgeMocks);

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      on: vi.fn(() => vi.fn()),
      emit: vi.fn(),
    })),
  },
}));

describe('cron workspace adapter', () => {
  beforeEach(() => {
    httpBridgeMocks.calls.length = 0;
    httpBridgeMocks.setResponse({});
  });

  it('preserves omitted, default and replacement workspace updates on the wire', async () => {
    const { cron } = await import('@/common/adapter/ipcBridge');
    for (const workspace of [undefined, null, '/new-project']) {
      await cron.updateJob.invoke({ job_id: 'job-1', updates: { metadata: { workspace } } });
      const call = httpBridgeMocks.calls.at(-1)!;
      const body = JSON.parse(JSON.stringify(call.body));
      if (workspace === undefined) expect(body).not.toHaveProperty('workspace');
      else expect(body.workspace).toBe(workspace);
    }
  });

  it('maps directory metadata from the backend response', async () => {
    const { fs } = await import('@/common/adapter/ipcBridge');
    httpBridgeMocks.setResponse({
      name: 'project',
      path: '/project',
      size: 0,
      type: 'directory',
      last_modified: 123,
      is_directory: true,
    });
    const metadata = await fs.getFileMetadata.invoke({ path: '/project', workspace: '/project' });
    expect(metadata.isDirectory).toBe(true);
    expect(metadata.lastModified).toBe(123);
  });
});
