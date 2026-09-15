/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The search providers the built-in `one-web-search` MCP can talk to.
 *
 * This module is imported by BOTH the renderer (to draw the settings form) and
 * the MCP server, which runs as a standalone stdio child process. It must
 * therefore stay pure data with no imports and no side effects — the same
 * constraint spelled out at the top of `builtinMcp/constants.ts`, where pulling
 * in `common/config/storage` would drag its side effects into a process that
 * has no business running them.
 *
 * Every provider here authenticates with a SINGLE API key. That was not a
 * given — the cloud vendors among them (Volcengine, Aliyun) usually sign
 * requests with an AK/SK pair, which a one-field form could not express.
 * Probed 2026-09-15 with no credentials, each answered an auth error rather
 * than a signature error:
 *
 *   api.bochaai.com/v1/web-search            Authorization: Bearer
 *   open.bigmodel.cn/api/paas/v4/web_search  401 "Header中未收到Authorization参数"
 *   ark.cn-beijing.volces.com/api/v3/web_search
 *                                            401 "API key or AK/SK ... missing"
 *   cloud-iqs.aliyuncs.com/search/genericSearch
 *                                            403 + the console URL to get a key
 *   api.tavily.com/search                    401 Unauthorized
 *   google.serper.dev/search                 403
 *   api.search.brave.com/res/v1/web/search   422, naming `x-subscription-token`
 *
 * Baidu/Sogou are deliberately absent: their raw search APIs return a short
 * abstract and expect the caller to crawl the page itself, so wiring them up
 * would mean shipping a crawler as well.
 */

/**
 * Name of the built-in MCP entry these providers configure.
 *
 * Lives here rather than in `builtinMcp/constants.ts` so the renderer can
 * import it without reaching across the process boundary — the same choice
 * already made for `BUILTIN_BROWSER_MCP_NAME` in `common/config/constants.ts`.
 */
export const WEB_SEARCH_MCP_NAME = 'one-web-search';

/** Stable ids. Persisted inside the MCP entry's `transport.env`, so renaming one strands a user's key. */
export type WebSearchProviderId =
  | 'bocha'
  | 'zhipu'
  | 'volcengine'
  | 'aliyun'
  | 'tavily'
  | 'serper'
  | 'brave'
  | 'tencent'
  | 'custom';

export type WebSearchProvider = {
  id: WebSearchProviderId;
  /** Vendor name. A proper noun — deliberately not translated. */
  label: string;
  /** Which half of the picker it belongs under; the heading itself is translated. */
  region: 'cn' | 'global' | 'custom';
  /** Env var carrying this provider's key, set on the MCP entry's `transport.env`. */
  envKey: string;
  /**
   * Env var holding a user-supplied endpoint that overrides `defaultBaseUrl`.
   *
   * A vendor moving or regionalising its API is not hypothetical: Agnes serves
   * the same product from `agnes-ai.com` and `agnes-ai.cn`, and a driver here
   * that hardcoded one of them answered `401 Invalid token` for every account
   * issued on the other. Baking an endpoint into a release means a vendor
   * change bricks search until the next version ships; this lets the user fix
   * it in the settings form instead.
   */
  baseUrlEnvKey: string;
  /** Endpoint used when the user has not overridden it. Shown, not hidden. */
  defaultBaseUrl: string;
  /** Where the user goes to get a key. Shown as a link next to the input. */
  apiKeyUrl?: string;
  /**
   * The user must supply the endpoint; a key alone is not enough.
   *
   * True for a user-defined provider, and for vendors whose URL embeds the
   * account's own instance or workspace — those have no shared default that
   * could work for anyone else.
   */
  requiresBaseUrl?: boolean;
  /**
   * A user-defined endpoint rather than one of the shipped vendors.
   *
   * The seven built-in entries cover the services checked against live APIs,
   * but pinning the list to them means a vendor we have not heard of — or one
   * added after this release — cannot be used at all. The custom entry takes
   * the request shape as configuration instead: header name, header prefix,
   * HTTP method and the name of the query field. Those four are what actually
   * differ between the vendors measured here; everything past them is handled
   * by the same structural response scan the built-ins already rely on.
   */
  custom?: boolean;
};

/** Env vars describing how to call a user-defined search endpoint. */
export const WEB_SEARCH_CUSTOM_ENV = {
  /** Header carrying the credential. Most services use `Authorization`. */
  authHeader: 'WEB_SEARCH_CUSTOM_AUTH_HEADER',
  /** Text before the key in that header, e.g. `Bearer `. Empty means the raw key. */
  authPrefix: 'WEB_SEARCH_CUSTOM_AUTH_PREFIX',
  /** `POST` (JSON body) or `GET` (query string). */
  method: 'WEB_SEARCH_CUSTOM_METHOD',
  /** Field the search text goes into — `query`, `q`, `search_query`, … */
  queryField: 'WEB_SEARCH_CUSTOM_QUERY_FIELD',
} as const;

/** Defaults chosen to match the most common shape among the measured vendors. */
export const WEB_SEARCH_CUSTOM_DEFAULTS = {
  authHeader: 'Authorization',
  authPrefix: 'Bearer ',
  method: 'POST',
  queryField: 'query',
} as const;

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = [
  {
    id: 'bocha',
    label: '博查 Bocha',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_BOCHA',
    baseUrlEnvKey: 'WEB_SEARCH_URL_BOCHA',
    defaultBaseUrl: 'https://api.bochaai.com/v1/web-search',
    apiKeyUrl: 'https://open.bochaai.com',
  },
  {
    id: 'zhipu',
    label: '智谱 Web Search',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_ZHIPU',
    baseUrlEnvKey: 'WEB_SEARCH_URL_ZHIPU',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/web_search',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'volcengine',
    label: '豆包搜索',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_VOLCENGINE',
    baseUrlEnvKey: 'WEB_SEARCH_URL_VOLCENGINE',
    defaultBaseUrl: 'https://open.feedcoopapi.com/search_api/web_search',
    apiKeyUrl: 'https://console.volcengine.com/torchlight',
  },
  {
    id: 'aliyun',
    label: '阿里云 OpenSearch',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_ALIYUN',
    baseUrlEnvKey: 'WEB_SEARCH_URL_ALIYUN',
    /**
     * No default, because there is no shared one to give.
     *
     * The URL is `{host}/v3/openapi/workspaces/{workspace}/web-search/
     * ops-web-search-001`, where the host carries the account's own instance
     * id (e.g. `xxxx-hangzhou.opensearch.aliyuncs.com`) and the workspace is
     * whatever the user named theirs. Shipping any fixed string here would be
     * a value that works for nobody.
     */
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    apiKeyUrl: 'https://help.aliyun.com/zh/open-search/search-platform/developer-reference/web-search',
  },
  {
    id: 'tencent',
    label: '腾讯云联网搜索',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_TENCENT',
    baseUrlEnvKey: 'WEB_SEARCH_URL_TENCENT',
    // The API-KEY entry point. Tencent also exposes this through
    // `wsa.tencentcloudapi.com` with Action/Version, but that path needs
    // TC3-HMAC-SHA256 request signing with an AK/SK pair, which a single-key
    // form cannot express. This host is the one that takes a plain Bearer key.
    defaultBaseUrl: 'https://api.wsa.cloud.tencent.com/SearchPro',
    apiKeyUrl: 'https://console.cloud.tencent.com/wsapi/index',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    region: 'global',
    envKey: 'WEB_SEARCH_KEY_TAVILY',
    baseUrlEnvKey: 'WEB_SEARCH_URL_TAVILY',
    defaultBaseUrl: 'https://api.tavily.com/search',
    apiKeyUrl: 'https://app.tavily.com/home',
  },
  {
    id: 'serper',
    label: 'Serper',
    region: 'global',
    envKey: 'WEB_SEARCH_KEY_SERPER',
    baseUrlEnvKey: 'WEB_SEARCH_URL_SERPER',
    defaultBaseUrl: 'https://google.serper.dev/search',
    apiKeyUrl: 'https://serper.dev/api-key',
  },
  {
    id: 'brave',
    label: 'Brave Search',
    region: 'global',
    envKey: 'WEB_SEARCH_KEY_BRAVE',
    baseUrlEnvKey: 'WEB_SEARCH_URL_BRAVE',
    defaultBaseUrl: 'https://api.search.brave.com/res/v1/web/search',
    apiKeyUrl: 'https://brave.com/search/api/',
  },
  {
    id: 'custom',
    label: 'Custom',
    region: 'custom',
    envKey: 'WEB_SEARCH_KEY_CUSTOM',
    baseUrlEnvKey: 'WEB_SEARCH_URL_CUSTOM',
    // No default: a custom endpoint has to be supplied, and an empty string is
    // how `configuredWebSearchProviders` knows it has not been.
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    custom: true,
  },
];

/** Env var naming which configured provider a search should actually use. */
export const WEB_SEARCH_DEFAULT_ENV = 'WEB_SEARCH_DEFAULT';

const BY_ID = new Map(WEB_SEARCH_PROVIDERS.map((p) => [p.id, p]));

export const getWebSearchProvider = (id: string | undefined): WebSearchProvider | undefined =>
  id ? BY_ID.get(id as WebSearchProviderId) : undefined;

/**
 * Which providers the user has actually supplied a key for, in catalog order.
 *
 * Reads straight from the MCP entry's env, so it gives the same answer in the
 * settings form and inside the MCP process — there is no second place where
 * "is this configured" could drift.
 */
export const configuredWebSearchProviders = (env: Record<string, string> | undefined): WebSearchProvider[] =>
  env
    ? WEB_SEARCH_PROVIDERS.filter((p) => {
        if (!env[p.envKey]?.trim()) return false;
        // Some providers ship no default endpoint — a user-defined one, or a
        // vendor whose URL embeds the account's own instance. For those a key
        // alone leaves the request with nowhere to go, so both halves must be
        // present before the provider counts as configured.
        return !p.requiresBaseUrl || !!env[p.baseUrlEnvKey]?.trim();
      })
    : [];

/**
 * The provider a search should run against.
 *
 * The stored default wins, but only while it still has a key — a user who
 * clears the key of their default provider should fall through to another
 * configured one rather than get failed searches until they notice the radio
 * button is pointing at nothing.
 */
export const resolveWebSearchProvider = (env: Record<string, string> | undefined): WebSearchProvider | undefined => {
  const configured = configuredWebSearchProviders(env);
  if (configured.length === 0) return undefined;
  const preferred = getWebSearchProvider(env?.[WEB_SEARCH_DEFAULT_ENV]?.trim());
  if (preferred && configured.some((p) => p.id === preferred.id)) return preferred;
  return configured[0];
};

/** The endpoint to call: the user's override when set, otherwise the default. */
export const resolveWebSearchBaseUrl = (provider: WebSearchProvider, env: Record<string, string> | undefined): string =>
  env?.[provider.baseUrlEnvKey]?.trim() || provider.defaultBaseUrl;
