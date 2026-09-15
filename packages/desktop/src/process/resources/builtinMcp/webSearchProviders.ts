/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-vendor request shaping and response normalisation for `one-web-search`.
 *
 * # What is verified here, and what is not
 *
 * Endpoints and auth headers were probed against the live services on
 * 2026-09-15 with no credentials; each answered an auth error rather than a 404
 * or a signature error, which is what pins both the path and the auth style.
 * Those are recorded per adapter below.
 *
 * Response SHAPES are a different matter. Only Bocha's is documented publicly,
 * and even there the sample is truncated after `"webPages"`. Every `pick`
 * path below is therefore marked with its evidence level, and none of them is
 * load-bearing on its own: `normalise` falls back to a structural scan
 * (`harvest`) that finds result objects anywhere in the payload. A wrong guess
 * about a field name degrades quality, it does not produce an empty result the
 * user cannot explain.
 *
 * When a real key becomes available, each adapter must be run once and its
 * `pick` path corrected from the actual body. Do not "confirm" these from
 * memory — the Agnes `extra_body` bug cost a debugging session precisely
 * because a vendor's prose disagreed with its own worked example.
 */

/** One result, in the single shape the model sees regardless of provider. */
export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type ProviderRequest = {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
};

export type ProviderAdapter = {
  /** Build the HTTP call. `count` is a hint; vendors clamp it themselves. */
  request(query: string, count: number, apiKey: string): ProviderRequest;
  /** Preferred path into the payload. May return nothing; `harvest` covers that. */
  pick(payload: Record<string, unknown>): unknown[];
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Walk `a.b.c` without throwing on a missing link. */
const at = (root: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as never)[key] : undefined), root);

export const WEB_SEARCH_ADAPTERS: Record<string, ProviderAdapter> = {
  /**
   * verified: endpoint + `Authorization: Bearer` from open.bochaai.com's own
   * page, which also shows the response opening with
   * `{"_type":"SearchResponse","queryContext":…,"webPages":…}` — a Bing-shaped
   * envelope. `webPages.value` is the Bing spelling; the published sample is
   * truncated before it, so treat it as likely rather than confirmed.
   */
  bocha: {
    request: (query, count, apiKey) => ({
      url: 'https://api.bochaai.com/v1/web-search',
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, count, summary: true }),
      },
    }),
    pick: (payload) => asArray(at(payload, 'data.webPages.value') ?? at(payload, 'webPages.value')),
  },

  /** verified: 401 "Header中未收到Authorization参数，无法进行身份验证。" */
  zhipu: {
    request: (query, count, apiKey) => ({
      url: 'https://open.bigmodel.cn/api/paas/v4/web_search',
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: apiKey },
        body: JSON.stringify({ search_engine: 'search_std', search_query: query, count }),
      },
    }),
    pick: (payload) => asArray(payload.search_result ?? at(payload, 'data.search_result')),
  },

  /** verified: 401 "the API key or AK/SK in the request is missing or invalid". */
  volcengine: {
    request: (query, count, apiKey) => ({
      url: 'https://ark.cn-beijing.volces.com/api/v3/web_search',
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, count }),
      },
    }),
    pick: (payload) => asArray(payload.results ?? at(payload, 'data.results')),
  },

  /**
   * verified: 403 "Incorrect APIKey provided. You can find your api key at
   * https://ipaas.console.aliyun.com/api-key" — which is also where the header
   * name comes from.
   */
  aliyun: {
    request: (query, _count, apiKey) => ({
      url: `https://cloud-iqs.aliyuncs.com/search/genericSearch?query=${encodeURIComponent(query)}`,
      init: {
        method: 'GET',
        headers: { ...JSON_HEADERS, 'X-API-Key': apiKey },
      },
    }),
    pick: (payload) => asArray(payload.pageItems ?? at(payload, 'data.pageItems')),
  },

  /**
   * verified with a live key 2026-09-15: results at `results[]`, each carrying
   * `url` / `title` / `content` (no date field).
   *
   * Tavily accepts the key BOTH as `Authorization: Bearer` and as `api_key` in
   * the body — measured, each sent alone answered HTTP 200. The header is the
   * one kept: a key in the request body is far more likely to end up in a log
   * or a captured payload than one in a header, and sending it twice doubles
   * that exposure for nothing.
   */
  tavily: {
    request: (query, count, apiKey) => ({
      url: 'https://api.tavily.com/search',
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, max_results: count }),
      },
    }),
    pick: (payload) => asArray(payload.results),
  },

  /** verified: 403 {"message":"Unauthorized. Sign up for a free account."} */
  serper: {
    request: (query, count, apiKey) => ({
      url: 'https://google.serper.dev/search',
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'X-API-KEY': apiKey },
        body: JSON.stringify({ q: query, num: count }),
      },
    }),
    pick: (payload) => asArray(payload.organic),
  },

  /**
   * verified: 422 naming the missing header outright —
   * {"error":{"code":"VALIDATION","meta":{"errors":[{"loc":["header","x-subscription-token"]…
   */
  brave: {
    request: (query, count, apiKey) => ({
      url: `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      init: {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
      },
    }),
    pick: (payload) => asArray(at(payload, 'web.results')),
  },
};

/** Field names vendors use for the same three things. */
const TITLE_KEYS = ['title', 'name', 'heading'];
const URL_KEYS = ['url', 'link', 'href', 'displayUrl', 'display_url'];
const SNIPPET_KEYS = ['snippet', 'summary', 'description', 'content', 'abstract', 'body', 'mainText', 'main_text'];
const DATE_KEYS = ['datePublished', 'date_published', 'publishTime', 'publish_time', 'published_date', 'date'];

const firstString = (row: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const toHit = (row: unknown): SearchHit | undefined => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const record = row as Record<string, unknown>;
  const url = firstString(record, URL_KEYS);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return {
    title: firstString(record, TITLE_KEYS) || url,
    url,
    snippet: firstString(record, SNIPPET_KEYS) || '',
    publishedAt: firstString(record, DATE_KEYS),
  };
};

/**
 * Find result objects anywhere in a payload.
 *
 * This is what keeps a wrong `pick` path from turning into "search returned
 * nothing" — a failure the user would report as the feature being broken and
 * which would take a live key to diagnose. Anything carrying an http(s) URL
 * plus a title-ish field counts.
 */
const harvest = (node: unknown, out: SearchHit[], depth = 0): void => {
  if (out.length >= 50 || depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = toHit(item);
      if (hit) out.push(hit);
      else harvest(item, out, depth + 1);
    }
    return;
  }
  for (const value of Object.values(node as Record<string, unknown>)) harvest(value, out, depth + 1);
};

/** Dedupe by URL, keeping the first (better-ranked) occurrence. */
const dedupe = (hits: SearchHit[]): SearchHit[] => {
  const seen = new Set<string>();
  return hits.filter((hit) => (seen.has(hit.url) ? false : (seen.add(hit.url), true)));
};

/**
 * Turn a vendor payload into hits: the adapter's own path first, a structural
 * scan when that comes up empty.
 */
export const normalise = (adapter: ProviderAdapter, payload: unknown, limit: number): SearchHit[] => {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const preferred = adapter
    .pick(root)
    .map(toHit)
    .filter((hit): hit is SearchHit => !!hit);
  if (preferred.length > 0) return dedupe(preferred).slice(0, limit);

  const scanned: SearchHit[] = [];
  harvest(root, scanned);
  return dedupe(scanned).slice(0, limit);
};
