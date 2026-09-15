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
import { WEB_SEARCH_PROVIDERS } from '@/common/webSearch/catalog';
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
      const base = WEB_SEARCH_PROVIDERS.find((p) => p.id === id)?.defaultBaseUrl || 'https://custom.test/search';
      const { url, init } = adapter.request('test query', 5, 'KEY-123', base);
      expect(url, id).toMatch(/^https:\/\//);
      const carriesKey = JSON.stringify(init.headers).includes('KEY-123') || (init.body ?? '').includes('KEY-123');
      expect(carriesKey, `${id} must send the api key somewhere`).toBe(true);
    }
  });

  it('puts the query on the wire for GET-style vendors too', () => {
    // Brave and Aliyun take the query in the URL, so a body-only builder would
    // silently search for nothing.
    expect(
      WEB_SEARCH_ADAPTERS.brave.request('北京天气', 3, 'k', 'https://api.search.brave.com/res/v1/web/search').url
    ).toContain(encodeURIComponent('北京天气'));
    expect(
      WEB_SEARCH_ADAPTERS.aliyun.request('北京天气', 3, 'k', 'https://cloud-iqs.aliyuncs.com/search/genericSearch').url
    ).toContain(encodeURIComponent('北京天气'));
  });

  it('uses each vendor’s own auth header, as confirmed by its rejection message', () => {
    expect(
      WEB_SEARCH_ADAPTERS.bocha.request('q', 1, 'k', 'https://api.bochaai.com/v1/web-search').init.headers.Authorization
    ).toBe('Bearer k');
    // Zhipu takes the raw key, not a Bearer prefix.
    expect(
      WEB_SEARCH_ADAPTERS.zhipu.request('q', 1, 'k', 'https://open.bigmodel.cn/api/paas/v4/web_search').init.headers
        .Authorization
    ).toBe('k');
    expect(
      WEB_SEARCH_ADAPTERS.serper.request('q', 1, 'k', 'https://google.serper.dev/search').init.headers['X-API-KEY']
    ).toBe('k');
    expect(
      WEB_SEARCH_ADAPTERS.brave.request('q', 1, 'k', 'https://api.search.brave.com/res/v1/web/search').init.headers[
        'X-Subscription-Token'
      ]
    ).toBe('k');
    expect(
      WEB_SEARCH_ADAPTERS.aliyun.request('q', 1, 'k', 'https://cloud-iqs.aliyuncs.com/search/genericSearch').init
        .headers['X-API-Key']
    ).toBe('k');
  });

  /**
   * Tavily accepts the key both as a Bearer header and as `api_key` in the
   * body — verified with a live key, each alone answered HTTP 200. Only the
   * header is sent: a credential in a request body is far likelier to be
   * captured in a log, and sending it twice doubles the exposure for nothing.
   */
  it('sends the Tavily key only as a header, never in the body', () => {
    const secret = 'tvly-SECRET-do-not-log';
    const { init } = WEB_SEARCH_ADAPTERS.tavily.request('q', 1, secret, 'https://api.tavily.com/search');
    expect(init.headers.Authorization).toBe(`Bearer ${secret}`);
    expect(init.body).not.toContain(secret);
    expect(JSON.parse(init.body!)).not.toHaveProperty('api_key');
  });
});

/**
 * The user-defined endpoint.
 *
 * Shipping only the seven measured vendors would mean a service we have not
 * heard of cannot be used at all. The four things that actually differed
 * between those seven — header name, header prefix, HTTP method, query field —
 * are configuration here, and the response is left to the structural scan.
 */
describe('custom provider', () => {
  const CUSTOM_URL = 'https://search.internal.test/api';

  it('defaults to the most common shape among the measured vendors', () => {
    const { url, init } = WEB_SEARCH_ADAPTERS.custom.request('cats', 5, 'k', CUSTOM_URL, {});
    expect(url).toBe(CUSTOM_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body!).query).toBe('cats');
  });

  it('takes the header name, prefix and query field from configuration', () => {
    const { init } = WEB_SEARCH_ADAPTERS.custom.request('cats', 5, 'k', CUSTOM_URL, {
      WEB_SEARCH_CUSTOM_AUTH_HEADER: 'X-API-KEY',
      WEB_SEARCH_CUSTOM_AUTH_PREFIX: '',
      WEB_SEARCH_CUSTOM_QUERY_FIELD: 'q',
    });
    // An empty prefix means the raw key, which is what Serper and Zhipu want.
    expect(init.headers['X-API-KEY']).toBe('k');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body!).q).toBe('cats');
  });

  it('switches to a query string when configured for GET', () => {
    const { url, init } = WEB_SEARCH_ADAPTERS.custom.request('北京天气', 5, 'k', CUSTOM_URL, {
      WEB_SEARCH_CUSTOM_METHOD: 'GET',
      WEB_SEARCH_CUSTOM_QUERY_FIELD: 'q',
    });
    expect(init.method).toBe('GET');
    expect(url).toBe(`${CUSTOM_URL}?q=${encodeURIComponent('北京天气')}`);
    expect(init.body).toBeUndefined();
  });

  it('appends to an endpoint that already carries a query string', () => {
    const { url } = WEB_SEARCH_ADAPTERS.custom.request('cats', 5, 'k', `${CUSTOM_URL}?lang=zh`, {
      WEB_SEARCH_CUSTOM_METHOD: 'GET',
    });
    expect(url).toBe(`${CUSTOM_URL}?lang=zh&query=cats`);
  });

  it('reads results out of an unknown envelope via the structural scan', () => {
    // No adapter path exists for a custom vendor, so this is the only route.
    const payload = { data: { items: [{ heading: 'Hit', href: 'https://x.test/a', abstract: 'text' }] } };
    const hits = normalise(WEB_SEARCH_ADAPTERS.custom, payload, 8);
    expect(hits).toEqual([{ title: 'Hit', url: 'https://x.test/a', snippet: 'text', publishedAt: undefined }]);
  });
});

/**
 * Volcengine's "Doubao search" is a separate product from Ark, with its own
 * host and PascalCase JSON.
 *
 * An earlier version guessed `ark.cn-beijing.volces.com/api/v3/web_search`
 * because the name sounds like an Ark model feature. Ark answered 401 — and a
 * 401 reads as "bad key", not "wrong product", so it sent the user hunting for
 * a credential problem that did not exist. Verified against the live service.
 */
describe('volcengine (Doubao search)', () => {
  const VOLC_URL = 'https://open.feedcoopapi.com/search_api/web_search';

  it('sends the PascalCase body the service requires', () => {
    const { url, init } = WEB_SEARCH_ADAPTERS.volcengine.request('cats', 5, 'k', VOLC_URL);
    expect(url).toBe(VOLC_URL);
    const body = JSON.parse(init.body!);
    expect(body.Query).toBe('cats');
    // SearchType is mandatory; without it the request is rejected.
    expect(body.SearchType).toBe('web');
    expect(body.Count).toBe(5);
    expect(body.query).toBeUndefined();
  });

  it('reads results out of the real response shape', () => {
    // Trimmed from a live 200 on 2026-09-15.
    const payload = {
      ResponseMetadata: { RequestId: 'x' },
      Result: {
        ResultCount: 1,
        WebResults: [
          {
            Id: '1',
            SortId: 0,
            Title: '首个“人工智能+脑机接口”标准发布-新华网',
            SiteName: '新华网',
            Url: 'http://www.xinhuanet.com/sci-tech/20260915/abc/c.html',
            Snippet: '我国第三个脑机接口医疗器械标准…',
            PublishTime: '2026-09-15T09:06:00+08:00',
          },
        ],
      },
    };
    const hits = normalise(WEB_SEARCH_ADAPTERS.volcengine, payload, 8);
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('http://www.xinhuanet.com/sci-tech/20260915/abc/c.html');
    expect(hits[0].title).toContain('脑机接口');
    expect(hits[0].publishedAt).toBe('2026-09-15T09:06:00+08:00');
  });

  /**
   * The casing rule, isolated.
   *
   * Field names are matched case-insensitively because vendors disagree about
   * casing as freely as they disagree about nesting. Without this, a PascalCase
   * payload yields zero hits from a perfectly good 200 — and the structural
   * fallback comes up empty on exactly the response it exists to rescue.
   */
  it('matches field names regardless of casing', () => {
    const payload = { items: [{ TITLE: 'Shouty', URL: 'https://x.test/a', SNIPPET: 'text' }] };
    const hits = normalise(WEB_SEARCH_ADAPTERS.custom, payload, 8);
    expect(hits[0]).toMatchObject({ title: 'Shouty', url: 'https://x.test/a', snippet: 'text' });
  });
});

/**
 * Tencent WSA, documentation-only (no key was available to run it).
 *
 * Pinned because its response is shaped unlike every other vendor here:
 * `Pages` is an array of JSON STRINGS, not objects. Passed to the structural
 * fallback untouched it yields nothing — a string has no fields to match — so
 * this is one of the few places where the adapter path is load-bearing rather
 * than an optimisation.
 */
describe('tencent WSA', () => {
  const URL = 'https://api.wsa.cloud.tencent.com/SearchPro';

  it('sends only Query, so a lower service tier cannot reject an extra field', () => {
    const { url, init } = WEB_SEARCH_ADAPTERS.tencent.request('cats', 20, 'k', URL);
    expect(url).toBe(URL);
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body!);
    expect(body.Query).toBe('cats');
    // Mode / Cnt / Industry are tier-gated; sending one the account lacks
    // risks failing a request that would otherwise have worked.
    expect(Object.keys(body)).toEqual(['Query']);
  });

  it('parses the JSON strings inside Pages', () => {
    const payload = {
      Query: '今天北京的天气',
      Pages: [
        JSON.stringify({
          title: '北京天气预报',
          date: '2026-09-15',
          url: 'https://weather.test/bj',
          passage: '今天多云',
          site: '天气网',
        }),
      ],
    };
    const hits = normalise(WEB_SEARCH_ADAPTERS.tencent, payload, 8);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('北京天气预报');
    expect(hits[0].url).toBe('https://weather.test/bj');
    // `passage` is Tencent's name for the snippet.
    expect(hits[0].snippet).toBe('今天多云');
  });

  it('skips an unparsable entry instead of failing the whole search', () => {
    const payload = { Pages: ['not json at all', JSON.stringify({ title: 'ok', url: 'https://x.test/a' })] };
    const hits = normalise(WEB_SEARCH_ADAPTERS.tencent, payload, 8);
    expect(hits.map((h) => h.url)).toEqual(['https://x.test/a']);
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
