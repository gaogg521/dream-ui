/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Search that works before the user has configured anything.
 *
 * The rule under test is a priority, not a feature: a key the user supplied
 * always beats the company broker. Getting that backwards would spend our
 * quota while their own paid key sat unused — and it would do so silently,
 * because both paths return results in the same shape.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_SEARCH_BROKER_URL_ENV,
  WEB_SEARCH_INSTALL_ID_ENV,
  WEB_SEARCH_PROVIDERS,
  hostedWebSearchEndpoint,
  resolveWebSearchRoute,
} from '@/common/webSearch/catalog';
import { runHostedSearch } from '@process/resources/builtinMcp/hostedSearch';

const keyOf = (id: string) => WEB_SEARCH_PROVIDERS.find((p) => p.id === id)!.envKey;

const hostedEnv = (extra: Record<string, string> = {}) => ({
  [WEB_SEARCH_BROKER_URL_ENV]: 'https://broker.test/trial-broker',
  [WEB_SEARCH_INSTALL_ID_ENV]: 'install-hash',
  ...extra,
});

describe('hostedWebSearchEndpoint', () => {
  it('builds the broker search URL, tolerating a trailing slash', () => {
    expect(hostedWebSearchEndpoint(hostedEnv())).toBe('https://broker.test/trial-broker/v1/search');
    expect(hostedWebSearchEndpoint({ ...hostedEnv(), [WEB_SEARCH_BROKER_URL_ENV]: 'https://broker.test/b///' })).toBe(
      'https://broker.test/b/v1/search'
    );
  });

  /**
   * Half a configuration is worse than none: the broker rejects a request with
   * no install id, so every search would fail with a 400 that names nothing
   * the user could act on.
   */
  it('needs both the broker URL and the install id', () => {
    expect(hostedWebSearchEndpoint({ [WEB_SEARCH_BROKER_URL_ENV]: 'https://broker.test' })).toBeUndefined();
    expect(hostedWebSearchEndpoint({ [WEB_SEARCH_INSTALL_ID_ENV]: 'install-hash' })).toBeUndefined();
    expect(hostedWebSearchEndpoint({ ...hostedEnv(), [WEB_SEARCH_INSTALL_ID_ENV]: '   ' })).toBeUndefined();
    expect(hostedWebSearchEndpoint(undefined)).toBeUndefined();
  });
});

describe('resolveWebSearchRoute', () => {
  it('falls back to the broker when the user has configured nothing', () => {
    const route = resolveWebSearchRoute(hostedEnv());
    expect(route.provider).toBeUndefined();
    expect(route.hostedEndpoint).toBe('https://broker.test/trial-broker/v1/search');
    expect(route.installId).toBe('install-hash');
  });

  /**
   * The priority that costs real money if inverted: their key, their quota,
   * usually a larger one, and it costs us nothing.
   */
  it('prefers a user key over the broker', () => {
    const route = resolveWebSearchRoute(hostedEnv({ [keyOf('bocha')]: 'k' }));
    expect(route.provider?.id).toBe('bocha');
    expect(route.hostedEndpoint).toBeUndefined();
  });

  it('returns nothing when there is neither a key nor a broker', () => {
    expect(resolveWebSearchRoute({})).toEqual({});
  });

  /**
   * A key that cannot actually run (an endpoint-required provider with no
   * endpoint) must not shadow working hosted search — otherwise typing half a
   * configuration breaks the search that was fine a moment earlier.
   */
  it('keeps the broker when the only key belongs to an unusable provider', () => {
    const route = resolveWebSearchRoute(hostedEnv({ WEB_SEARCH_KEY_CUSTOM: 'k' }));
    expect(route.provider).toBeUndefined();
    expect(route.hostedEndpoint).toBe('https://broker.test/trial-broker/v1/search');
  });
});

describe('runHostedSearch', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (status: number, body: unknown) => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('sends the install id and query, and maps published_at onto publishedAt', async () => {
    const fetchMock = stubFetch(200, {
      provider: 'tavily',
      results: [
        { title: 'A', url: 'https://a.test/1', snippet: 'body a' },
        { title: 'B', url: 'https://b.test/2', snippet: 'body b', published_at: '2026-01-02' },
      ],
      quota: { used_today: 1, daily_limit: 50, remaining: 49 },
    });

    const outcome = await runHostedSearch('https://broker.test/v1/search', 'install-hash', 'q', 5, 1000);

    expect(outcome.ok).toBe(true);
    expect(outcome.hits).toHaveLength(2);
    expect(outcome.hits[1].publishedAt).toBe('2026-01-02');
    expect(outcome.hits[0].publishedAt).toBeUndefined();
    expect(outcome.remainingToday).toBe(49);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ install_id: 'install-hash', query: 'q', count: 5 });
  });

  /**
   * The one the model must be told about rather than retried: the code is what
   * distinguishes "wait until tomorrow or add a key" from "the network blipped".
   */
  it('surfaces the broker error code', async () => {
    stubFetch(429, { error: 'search_quota_exhausted' });
    const outcome = await runHostedSearch('https://broker.test/v1/search', 'i', 'q', 5, 1000);
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBe('search_quota_exhausted');
    expect(outcome.status).toBe(429);
  });

  /**
   * Something in front of the broker answering — a proxy error page, a captive
   * portal — is not a broker error and has no code to read.
   */
  it('keeps the body when the reply is not JSON', async () => {
    stubFetch(502, '<html>Bad Gateway</html>');
    const outcome = await runHostedSearch('https://broker.test/v1/search', 'i', 'q', 5, 1000);
    expect(outcome.ok).toBe(false);
    expect(outcome.errorCode).toBeUndefined();
    expect(outcome.detail).toContain('Bad Gateway');
  });

  it('drops a result with no url rather than showing an empty citation', async () => {
    stubFetch(200, { results: [{ title: 'no link' }, { title: 'ok', url: 'https://a.test/1' }] });
    const outcome = await runHostedSearch('https://broker.test/v1/search', 'i', 'q', 5, 1000);
    expect(outcome.hits.map((h) => h.url)).toEqual(['https://a.test/1']);
  });

  it('reports a transport failure without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('connect ECONNREFUSED')))
    );
    const outcome = await runHostedSearch('https://broker.test/v1/search', 'i', 'q', 5, 1000);
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('ECONNREFUSED');
  });
});
