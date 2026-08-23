/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The main process cannot read the renderer's enterprise pointer, so anything
 * here that needs company data has to be told where it lives. These tests pin
 * that routing, because getting it wrong fails *silently*: a member's local
 * backend answers every governance question with "there is no company", which
 * reads exactly like "the company allows it".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GovernanceUnavailableError,
  governanceFetch,
  isGovernanceRemote,
  localBackendBaseUrl,
  setGovernanceEndpoint,
} from '@process/services/governanceEndpoint';

type GlobalWithPort = typeof globalThis & { __backendPort?: number };

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { allow: true } }));
  vi.stubGlobal('fetch', fetchMock);
  (globalThis as GlobalWithPort).__backendPort = 13400;
  setGovernanceEndpoint(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setGovernanceEndpoint(null);
  delete (globalThis as GlobalWithPort).__backendPort;
});

describe('governanceFetch routing', () => {
  it('uses the local backend when no remote was pushed', async () => {
    await governanceFetch('POST', '/api/one/billing/media-precheck', { model: 'x' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:13400/api/one/billing/media-precheck');
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
    expect(isGovernanceRemote()).toBe(false);
  });

  // The whole point: on a member's machine the company lives on the server.
  it('uses the remote server and carries the bearer token once pushed', async () => {
    setGovernanceEndpoint({ baseUrl: 'https://one.corp.example', token: 'tok_abc' });

    await governanceFetch('POST', '/api/one/billing/media-precheck', { model: 'x' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://one.corp.example/api/one/billing/media-precheck');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok_abc' });
    expect(isGovernanceRemote()).toBe(true);
  });

  // A half-filled endpoint is worse than none: it would send unauthenticated
  // requests to the company server, which answers for nobody.
  it('ignores an endpoint missing either half', async () => {
    setGovernanceEndpoint({ baseUrl: 'https://one.corp.example', token: '' });
    expect(isGovernanceRemote()).toBe(false);

    setGovernanceEndpoint({ baseUrl: '', token: 'tok_abc' });
    expect(isGovernanceRemote()).toBe(false);

    await governanceFetch('GET', '/api/one/billing/plan');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:13400/api/one/billing/plan');
  });

  it('falls back to local again when the session ends', async () => {
    setGovernanceEndpoint({ baseUrl: 'https://one.corp.example', token: 'tok_abc' });
    setGovernanceEndpoint(null);

    await governanceFetch('GET', '/api/one/billing/plan');
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:13400/api/one/billing/plan');
  });
});

describe('governanceFetch responses', () => {
  it('unwraps the backend envelope like httpBridge does', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { allow: false, reason: 'over budget' } }));
    await expect(governanceFetch('POST', '/api/one/billing/media-precheck', {})).resolves.toEqual({
      allow: false,
      reason: 'over budget',
    });
  });

  it('returns an unenveloped body unchanged', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ allow: true }));
    await expect(governanceFetch('POST', '/api/one/billing/media-precheck', {})).resolves.toEqual({ allow: true });
  });

  it('throws with the status on a non-2xx answer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 403));
    await expect(governanceFetch('GET', '/api/one/billing/plan')).rejects.toThrow('HTTP 403');
  });

  it('reports a distinct error when no backend is reachable at all', async () => {
    delete (globalThis as GlobalWithPort).__backendPort;
    await expect(governanceFetch('GET', '/api/one/billing/plan')).rejects.toBeInstanceOf(GovernanceUnavailableError);
    expect(localBackendBaseUrl()).toBeNull();
  });
});
