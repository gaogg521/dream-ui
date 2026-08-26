/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which API paths reach the company server in enterprise client mode.
 *
 * This is the renderer half of the same problem `governanceEndpoint.test.ts`
 * pins for the main process: a member's machine runs its own aioncore, and any
 * enterprise-scoped path that resolves there reads empty local tables. The
 * failure is silent in the worst way — "no licence, no budget, no members"
 * looks exactly like "everything is permitted".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const REMOTE = 'https://one.corp.example';

let httpRequest: typeof import('@/common/adapter/httpBridge').httpRequest;
let fetchMock: ReturnType<typeof vi.fn>;

const enterModeOn = () => {
  localStorage.setItem('one-enterprise:enabled', 'true');
  localStorage.setItem('one-enterprise:server-url', REMOTE);
  localStorage.setItem('one-enterprise:session', JSON.stringify({ token: 'tok', userId: 'u', username: 'u' }));
};

beforeEach(async () => {
  localStorage.clear();
  (window as Window & { __backendPort?: number }).__backendPort = 13400;
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true, data: {} }),
  });
  vi.stubGlobal('fetch', fetchMock);
  ({ httpRequest } = await import('@/common/adapter/httpBridge'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const calledUrl = (): string => fetchMock.mock.calls[0][0] as string;

describe('enterprise client mode routing', () => {
  // The licence, the budget and the usage ledger are enterprise-scoped rows
  // that only exist on the server. Reading them locally showed no plan in the
  // console and let every spend-capped call through.
  it.each([
    '/api/one/billing/plan',
    '/api/one/billing/usage',
    '/api/one/billing/license',
    '/api/one/billing/media-precheck',
    '/api/one/billing/media-usage',
  ])('sends %s to the company server', async (path) => {
    enterModeOn();
    await httpRequest('GET', path);
    expect(calledUrl()).toBe(`${REMOTE}${path}`);
  });

  it('carries the bearer token on billing calls', async () => {
    enterModeOn();
    await httpRequest('GET', '/api/one/billing/plan');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it.each(['/api/one/org/context', '/api/one/admin/users', '/api/one/devops/rag/search', '/api/one/enterprise/me'])(
    'keeps %s on the company server as before',
    async (path) => {
      enterModeOn();
      await httpRequest('GET', path);
      expect(calledUrl()).toBe(`${REMOTE}${path}`);
    }
  );

  // Local-first is the whole design: a member's conversations, agent and files
  // run on their own machine and must keep working when the server is down.
  it.each(['/api/conversations', '/api/providers', '/api/fs/list', '/api/one/billing-ish-but-not'])(
    'leaves %s on the local backend',
    async (path) => {
      enterModeOn();
      await httpRequest('GET', path);
      expect(calledUrl()).toBe(`http://127.0.0.1:13400${path}`);
    }
  );

  // Personal / standalone installs must not gain a single network call.
  it('sends billing to the local backend when no company is configured', async () => {
    await httpRequest('GET', '/api/one/billing/plan');
    expect(calledUrl()).toBe('http://127.0.0.1:13400/api/one/billing/plan');
  });
});
