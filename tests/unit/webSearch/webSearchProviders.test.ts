/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Request shaping and response normalisation per search vendor.
 *
 * Endpoints and auth headers were probed against the live services on
 * 2026-09-15 and each answered an auth error rather than a 404 or a signature
 * error, which is what pins both. Sending an invalid key through the real MCP
 * server produced, per vendor:
 *
 *   Bocha       401 {"code":"401","message":"Invalid API KEY"}
 *   Zhipu       401 {"error":{"code":"401","message":"令牌已过期或验证不正确"}}
 *   Volcengine  401 "The API key format is incorrect"
 *   Aliyun      403 "Incorrect APIKey provided"
 *   Serper      403 {"message":"Unauthorized."}
 *   Brave       422 "The provided subscription token is invalid"
 *
 * Every one of those says the credential was READ and rejected — not that it
 * was missing — so the header names below are confirmed, not guessed.
 *
 * Bocha and Tavily were then run with live keys, which also pins their response
 * shapes: `data.webPages.value` with a `name` title for Bocha, and `results[]`
 * with `url` / `title` / `content` for Tavily.
 */

import { describe, expect, it } from 'vitest';
import { WEB_SEARCH_ADAPTERS, normalise } from '@process/resources/builtinMcp/webSearchProviders';

/**
 * A real Bocha response, trimmed to one result.
 *
 * Captured 2026-09-15 from `api.bochaai.com/v1/web-search` with a live key.
 * The nesting is the part worth pinning: results sit at `data.webPages.value`,
 * two levels deeper than the Bing-shaped envelope suggests at a glance, and the
 * title field is `name` rather than `title`.
 */
const BOCHA_RESPONSE = {
  code: 200,
  log_id: 'e4abd2fde7d754ef',
  msg: null,
  data: {
    _type: 'SearchResponse',
    queryContext: { originalQuery: '今天有什么AI新闻' },
    webPages: {
      webSearchUrl: 'https://bochaai.com/search?q=x',
      totalEstimatedMatches: 114678,
      value: [
        {
          id: 'https://api.bochaai.com/v1/#WebPages.0',
          name: '午评:AI会急踩“刹车”吗?- CFi.CN 中财网',
          url: 'https://stock.cfi.cn/p20260915001264.html',
          displayUrl: 'https://stock.cfi.cn/p20260915001264.html',
          snippet: '午评:AI会急踩“刹车”吗?\n时间:2026年09月15日\n11:34:45\n中财网',
          summary: '午评全文……',
          siteName: '中财网股票频道',
          datePublished: '2026-09-15T11:34:45+08:00',
        },
      ],
      someResultsRemoved: true,
    },
  },
};

describe('vendor request shaping', () => {
  it('covers every adapter with an https endpoint and a credential', () => {
    for (const [id, adapter] of Object.entries(WEB_SEARCH_ADAPTERS)) {
      const { url, init } = adapter.request('test query', 5, 'KEY-123');
      expect(url, id).toMatch(/^https:\/\//);
      const carriesKey = JSON.stringify(init.headers).includes('KEY-123') || (init.body ?? '').includes('KEY-123');
      expect(carriesKey, `${id} must send the api key somewhere`).toBe(true);
    }
  });

  it('puts the query on the wire for GET-style vendors too', () => {
    // Brave and Aliyun take the query in the URL, so a body-only builder would
    // silently search for nothing.
    expect(WEB_SEARCH_ADAPTERS.brave.request('北京天气', 3, 'k').url).toContain(encodeURIComponent('北京天气'));
    expect(WEB_SEARCH_ADAPTERS.aliyun.request('北京天气', 3, 'k').url).toContain(encodeURIComponent('北京天气'));
  });

  it('uses each vendor’s own auth header, as confirmed by its rejection message', () => {
    expect(WEB_SEARCH_ADAPTERS.bocha.request('q', 1, 'k').init.headers.Authorization).toBe('Bearer k');
    // Zhipu takes the raw key, not a Bearer prefix.
    expect(WEB_SEARCH_ADAPTERS.zhipu.request('q', 1, 'k').init.headers.Authorization).toBe('k');
    expect(WEB_SEARCH_ADAPTERS.serper.request('q', 1, 'k').init.headers['X-API-KEY']).toBe('k');
    expect(WEB_SEARCH_ADAPTERS.brave.request('q', 1, 'k').init.headers['X-Subscription-Token']).toBe('k');
    expect(WEB_SEARCH_ADAPTERS.aliyun.request('q', 1, 'k').init.headers['X-API-Key']).toBe('k');
  });

  /**
   * Tavily accepts the key both as a Bearer header and as `api_key` in the
   * body — verified with a live key, each alone answered HTTP 200. Only the
   * header is sent: a credential in a request body is far likelier to be
   * captured in a log, and sending it twice doubles the exposure for nothing.
   */
  it('sends the Tavily key only as a header, never in the body', () => {
    const secret = 'tvly-SECRET-do-not-log';
    const { init } = WEB_SEARCH_ADAPTERS.tavily.request('q', 1, secret);
    expect(init.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(init.body).not.toContain(secret);
    expect(JSON.parse(init.body!)).not.toHaveProperty('api_key');
  });
});

describe('normalise', () => {
  it('reads a real Bocha response through the adapter path', () => {
    const hits = normalise(WEB_SEARCH_ADAPTERS.bocha, BOCHA_RESPONSE, 8);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('https://stock.cfi.cn/p20260915001264.html');
    // `name`, not `title` — the mapping table has to know that.
    expect(hits[0].title).toContain('午评');
    expect(hits[0].publishedAt).toBe('2026-09-15T11:34:45+08:00');
  });

  /**
   * The guard that keeps a wrong `pick` path from reading as "search is
   * broken". Only Bocha's shape is documented; the rest were written from
   * their endpoints alone, so a mismatch is likely for at least one vendor —
   * and the visible symptom would otherwise be zero results, which no user
   * could diagnose and which needs a live key to reproduce.
   */
  it('still finds results when the adapter path misses entirely', () => {
    const adapter = { ...WEB_SEARCH_ADAPTERS.bocha, pick: () => [] };
    const hits = normalise(adapter, BOCHA_RESPONSE, 8);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('https://stock.cfi.cn/p20260915001264.html');
  });

  it('ignores objects that carry no usable link', () => {
    const payload = { results: [{ title: 'no link here' }, { url: 'not-a-url', title: 'bad scheme' }] };
    expect(normalise(WEB_SEARCH_ADAPTERS.tavily, payload, 8)).toEqual([]);
  });

  it('drops duplicate URLs, keeping the better-ranked one', () => {
    const payload = {
      results: [
        { title: 'first', url: 'https://x.test/a' },
        { title: 'second', url: 'https://x.test/a' },
        { title: 'third', url: 'https://x.test/b' },
      ],
    };
    const hits = normalise(WEB_SEARCH_ADAPTERS.tavily, payload, 8);
    expect(hits.map((h) => h.title)).toEqual(['first', 'third']);
  });

  it('honours the requested limit', () => {
    const payload = {
      results: Array.from({ length: 30 }, (_, i) => ({ title: `t${i}`, url: `https://x.test/${i}` })),
    };
    expect(normalise(WEB_SEARCH_ADAPTERS.tavily, payload, 5)).toHaveLength(5);
  });

  it('survives a payload that is not an object at all', () => {
    expect(normalise(WEB_SEARCH_ADAPTERS.tavily, null, 8)).toEqual([]);
    expect(normalise(WEB_SEARCH_ADAPTERS.tavily, 'nonsense', 8)).toEqual([]);
  });
});
