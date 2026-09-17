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

import {
  WEB_SEARCH_CUSTOM_DEFAULTS,
  WEB_SEARCH_CUSTOM_ENV,
  ZHIPU_ENGINE_DEFAULT,
  ZHIPU_ENGINE_ENV,
} from '../../../common/webSearch/catalog';

/** One result, in the single shape the model sees regardless of provider. */
export type SearchHit = {
  title: string;
  /**
   * Absent when the source supplied no link.
   *
   * Every vendor adapter below requires one — a result it cannot link to is
   * dropped. The hosted (broker-run) path is the exception: Zhipu returns
   * whole dated summaries with an empty link for much of the Chinese news it
   * indexes, and discarding those emptied that provider exactly where it was
   * added to help. Optional rather than an empty string, so the renderer has
   * to decide what to say instead of printing a broken citation.
   */
  url?: string;
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
  /**
   * Build the HTTP call. `count` is a hint; vendors clamp it themselves.
   *
   * `baseUrl` arrives from the catalog's default or the user's override — an
   * endpoint is never hardcoded here, because a vendor that moves or
   * regionalises its API would otherwise break search until the next release.
   */
  request(query: string, count: number, apiKey: string, baseUrl: string, env?: Record<string, string>): ProviderRequest;
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

/**
 * `count` for a Zhipu engine.
 *
 * Sogou does not take an arbitrary number — the vendor schema allows only
 * 10/20/30/40/50 — so a model asking for 8 results would be sending a value
 * the API rejects or silently reinterprets. The other engines take 1-50.
 */
const zhipuCount = (engine: string, count: number): number => {
  if (engine !== 'search_pro_sogou') return count;
  return count <= 10 ? 10 : 20;
};

export const WEB_SEARCH_ADAPTERS: Record<string, ProviderAdapter> = {
  /**
   * verified: endpoint + `Authorization: Bearer` from open.bochaai.com's own
   * page, which also shows the response opening with
   * `{"_type":"SearchResponse","queryContext":…,"webPages":…}` — a Bing-shaped
   * envelope. `webPages.value` is the Bing spelling; the published sample is
   * truncated before it, so treat it as likely rather than confirmed.
   */
  bocha: {
    request: (query, count, apiKey, baseUrl) => ({
      url: baseUrl,
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, count, summary: true }),
      },
    }),
    pick: (payload) => asArray(at(payload, 'data.webPages.value') ?? at(payload, 'webPages.value')),
  },

  /**
   * verified against docs.bigmodel.cn (Web Search API) 2026-09-15.
   *
   * The header was WRONG here until that read. A probe with no credentials
   * answered `401 Header中未收到Authorization参数`, which says only that the
   * header is absent — it says nothing about the format — and the raw key was
   * guessed from Zhipu's older JWT-style auth. The docs' own curl is
   * `Authorization: Bearer <token>`, so every request would have been rejected
   * while looking exactly like a bad key.
   *
   * Body and response path were right: `{search_query, search_engine, count}`
   * → `search_result[]` of `{title, link, content, publish_date}`.
   */
  zhipu: {
    /**
     * `search_engine` is the user's to choose: the tiers differ by 3-5x in
     * price and in how hard they work the query, and only the person paying
     * for the key can weigh that. Defaults to the cheapest.
     */
    request: (query, count, apiKey, baseUrl, env) => {
      const engine = env?.[ZHIPU_ENGINE_ENV]?.trim() || ZHIPU_ENGINE_DEFAULT;
      return {
        url: baseUrl,
        init: {
          method: 'POST',
          headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            search_engine: engine,
            search_query: query,
            count: zhipuCount(engine, count),
            /**
             * Required by the vendor schema, and the value matters: with intent
             * detection on, a query it reads as conversational comes back
             * `SEARCH_NONE` and no search runs at all. This tool is only called
             * when a search is already wanted.
             */
            search_intent: false,
          }),
        },
      };
    },
    pick: (payload) => asArray(payload.search_result ?? at(payload, 'data.search_result')),
  },

  /**
   * verified with a live key 2026-09-15 against the product's own docs
   * (docs.volcengine.com/docs/87772/2272953).
   *
   * This one was wrong in every part of an earlier guess, and the guess looked
   * plausible the whole way: "Doubao search" sounds like a Volcengine Ark
   * model feature, so it was pointed at `ark.cn-beijing.volces.com/api/v3/
   * web_search` with a lowercase body. Ark answered `401` — and a 401 reads as
   * "bad key", not as "this endpoint has nothing to do with the product", so it
   * sent the search for a key problem that did not exist.
   *
   * It is a separate product with its own host, and its JSON is PascalCase:
   *   POST open.feedcoopapi.com/search_api/web_search
   *   { Query, SearchType: 'web', Count, Filter }   ← SearchType is required
   *   → Result.WebResults[] of { Title, Url, Snippet, PublishTime, SiteName }
   */
  volcengine: {
    request: (query, count, apiKey, baseUrl) => ({
      url: baseUrl,
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        // `NeedUrl` keeps out results with no link, which are useless to cite.
        body: JSON.stringify({ Query: query, SearchType: 'web', Count: count, Filter: { NeedUrl: true } }),
      },
    }),
    pick: (payload) => asArray(at(payload, 'Result.WebResults')),
  },

  /**
   * Aliyun's AI 搜索开放平台 (OpenSearch), 联网搜索 service.
   *
   * An earlier version pointed this at `cloud-iqs.aliyuncs.com/search/
   * genericSearch`, which is a DIFFERENT Aliyun product (信息查询服务 IQS).
   * That endpoint answered `403 Incorrect APIKey provided` and even named a
   * key console — evidence strong enough to look settled, and still the wrong
   * product. Aliyun sells several search services and their error messages do
   * not distinguish themselves.
   *
   * verified: help.aliyun.com/zh/open-search/search-platform/developer-
   * reference/web-search (2026-09-15). Not run against the live service — no
   * key available.
   *
   * The URL has no shared default: it is
   * `{host}/v3/openapi/workspaces/{workspace}/web-search/ops-web-search-001`,
   * where the host carries the account's own instance id. Hence
   * `requiresBaseUrl` on the catalog entry.
   *
   * `content_type` and `way` are left unset so the service's own defaults
   * (`snippet` / `pro`) apply — sending a heavier mode changes both latency
   * and billing.
   */
  aliyun: {
    request: (query, count, apiKey, baseUrl) => ({
      url: baseUrl,
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, top_k: count }),
      },
    }),
    pick: (payload) =>
      asArray(at(payload, 'result.search_result')).map((row) => {
        if (!row || typeof row !== 'object') return row;
        const record = row as Record<string, unknown>;
        // The date sits at `meta_info.publishedTime`; field matching only
        // looks at top-level keys, so lift it rather than lose it.
        const published = at(record, 'meta_info.publishedTime');
        return typeof published === 'string' ? { ...record, publishedTime: published } : record;
      }),
  },

  /**
   * Tencent's 联网搜索 API (WSA), API-KEY entry point.
   *
   * verified: docs.tencent.com product 1806, docs 130615 / 121811. NOT run
   * against the live service — no key was available — so unlike Bocha, Tavily
   * and Volcengine this one is documentation-only. Treat a first failure here
   * as "the shape may be wrong", not "the user's key is bad".
   *
   * Two things are unusual enough to be worth stating:
   *
   * - `Pages` is an Array of STRING, each holding a JSON document
   *   (`{title,date,url,passage,site,score}`). Handed to the structural scan
   *   as-is it yields nothing, because strings carry no fields to match — so
   *   `pick` parses them rather than relying on the fallback.
   * - The body is kept to `Query` alone on purpose. `Mode`, `Cnt` and
   *   `Industry` are each documented as available only on higher service
   *   tiers, and sending a parameter the account's tier does not support risks
   *   failing a request that would otherwise have worked.
   *
   * There is a second entry point at `wsa.tencentcloudapi.com` taking
   * `Action`/`Version`, but it requires TC3-HMAC-SHA256 signing with an AK/SK
   * pair, which a one-key form cannot express.
   */
  tencent: {
    request: (query, _count, apiKey, baseUrl) => ({
      url: baseUrl,
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ Query: query }),
      },
    }),
    pick: (payload) =>
      asArray(payload.Pages ?? at(payload, 'Response.Pages')).map((page) => {
        if (typeof page !== 'string') return page;
        try {
          return JSON.parse(page);
        } catch {
          return undefined;
        }
      }),
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
    request: (query, count, apiKey, baseUrl) => ({
      url: baseUrl,
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
    request: (query, count, apiKey, baseUrl) => ({
      url: baseUrl,
      init: {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'X-API-KEY': apiKey },
        body: JSON.stringify({ q: query, num: count }),
      },
    }),
    pick: (payload) => asArray(payload.organic),
  },

  /**
   * A user-defined endpoint.
   *
   * The seven entries above were each measured against the live service; this
   * one cannot be, because only the user knows what it points at. So the four
   * things that actually differed between those seven are configuration here —
   * header name, header prefix, HTTP method, query field name — with defaults
   * matching the most common shape. Everything downstream is unchanged: the
   * response goes through the same structural scan, which is what makes an
   * unknown vendor's payload readable without an adapter written for it.
   */
  custom: {
    request: (query, count, apiKey, baseUrl, env) => {
      const cfg = env || {};
      const header = cfg[WEB_SEARCH_CUSTOM_ENV.authHeader]?.trim() || WEB_SEARCH_CUSTOM_DEFAULTS.authHeader;
      const prefix = cfg[WEB_SEARCH_CUSTOM_ENV.authPrefix] ?? WEB_SEARCH_CUSTOM_DEFAULTS.authPrefix;
      const field = cfg[WEB_SEARCH_CUSTOM_ENV.queryField]?.trim() || WEB_SEARCH_CUSTOM_DEFAULTS.queryField;
      const method = (cfg[WEB_SEARCH_CUSTOM_ENV.method]?.trim() || WEB_SEARCH_CUSTOM_DEFAULTS.method).toUpperCase();
      const headers: Record<string, string> = { ...JSON_HEADERS, [header]: `${prefix}${apiKey}` };

      if (method === 'GET') {
        const joiner = baseUrl.includes('?') ? '&' : '?';
        return {
          url: `${baseUrl}${joiner}${encodeURIComponent(field)}=${encodeURIComponent(query)}`,
          init: { method: 'GET', headers },
        };
      }
      return {
        url: baseUrl,
        init: { method: 'POST', headers, body: JSON.stringify({ [field]: query, count, num: count }) },
      };
    },
    // No known envelope — the structural scan does all the work.
    pick: () => [],
  },

  /**
   * verified: 422 naming the missing header outright —
   * {"error":{"code":"VALIDATION","meta":{"errors":[{"loc":["header","x-subscription-token"]…
   */
  brave: {
    request: (query, count, apiKey, baseUrl) => ({
      url: `${baseUrl}?q=${encodeURIComponent(query)}&count=${count}`,
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
const SNIPPET_KEYS = [
  'snippet',
  'summary',
  'description',
  'content',
  'abstract',
  'passage',
  'body',
  'mainText',
  'main_text',
];
const DATE_KEYS = [
  'datePublished',
  'date_published',
  'publishTime',
  'publishedTime',
  'publish_time',
  // Zhipu spells it `publish_date`; near-miss spellings like this are why the
  // list is long rather than clever.
  'publish_date',
  'published_date',
  'date',
];

/**
 * Case-insensitive field lookup.
 *
 * Not a nicety: Volcengine returns `Title` / `Url` / `Snippet` / `PublishTime`
 * in PascalCase, so an exact lowercase match reads nothing out of a perfectly
 * good 200 response — the structural fallback would come up empty on exactly
 * the payloads it exists to rescue. Vendors disagree about casing as freely as
 * they disagree about nesting.
 */
const firstString = (row: Record<string, unknown>, keys: string[]): string | undefined => {
  const byLower = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) byLower.set(key.toLowerCase(), value);
  for (const key of keys) {
    const value = byLower.get(key.toLowerCase());
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

/**
 * Outcome of one provider call, in the form both callers need.
 *
 * Deliberately one flat shape rather than a discriminated union on `ok`: this
 * project compiles without `strictNullChecks`, and without it TypeScript does
 * not narrow a union by a literal boolean field — every access after an
 * `if (outcome.ok)` guard still fails to compile. A flat record with optional
 * fields is what actually type-checks here.
 */
export type SearchOutcome = {
  ok: boolean;
  hits?: SearchHit[];
  status?: number;
  body?: string;
  reason?: 'http' | 'network' | 'timeout' | 'badJson';
};

/**
 * Run one search against one provider.
 *
 * Shared deliberately by the MCP tool and by the settings page's "test"
 * button. A test that exercised a different path could pass while real
 * searches fail — which is the only failure mode a connection test exists to
 * rule out, so it must be the same request, the same parsing, the same
 * everything but the wording of the result.
 */
export const runProviderSearch = async (
  adapter: ProviderAdapter,
  apiKey: string,
  baseUrl: string,
  query: string,
  count: number,
  timeoutMs: number,
  env?: Record<string, string>
): Promise<SearchOutcome> => {
  const { url, init } = adapter.request(query, count, apiKey, baseUrl, env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) return { ok: false, status: response.status, body: raw, reason: 'http' };
    try {
      return { ok: true, hits: normalise(adapter, JSON.parse(raw), count) };
    } catch {
      return { ok: false, body: raw, reason: 'badJson' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, body: message, reason: message.includes('abort') ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
};
