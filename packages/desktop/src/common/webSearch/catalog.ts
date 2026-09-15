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
export type WebSearchProviderId = 'bocha' | 'zhipu' | 'volcengine' | 'aliyun' | 'tavily' | 'serper' | 'brave';

export type WebSearchProvider = {
  id: WebSearchProviderId;
  /** Vendor name. A proper noun — deliberately not translated. */
  label: string;
  /** Which half of the picker it belongs under; the heading itself is translated. */
  region: 'cn' | 'global';
  /** Env var carrying this provider's key, set on the MCP entry's `transport.env`. */
  envKey: string;
  /** Where the user goes to get a key. Shown as a link next to the input. */
  apiKeyUrl: string;
};

export const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = [
  {
    id: 'bocha',
    label: '博查 Bocha',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_BOCHA',
    apiKeyUrl: 'https://open.bochaai.com',
  },
  {
    id: 'zhipu',
    label: '智谱 Web Search',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_ZHIPU',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'volcengine',
    label: '豆包搜索（火山方舟）',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_VOLCENGINE',
    apiKeyUrl: 'https://console.volcengine.com/ark',
  },
  {
    id: 'aliyun',
    label: '阿里云 IQS',
    region: 'cn',
    envKey: 'WEB_SEARCH_KEY_ALIYUN',
    // Handed over by the API itself in its 403 body.
    apiKeyUrl: 'https://ipaas.console.aliyun.com/api-key',
  },
  {
    id: 'tavily',
    label: 'Tavily',
    region: 'global',
    envKey: 'WEB_SEARCH_KEY_TAVILY',
    apiKeyUrl: 'https://app.tavily.com/home',
  },
  {
    id: 'serper',
    label: 'Serper',
    region: 'global',
    envKey: 'WEB_SEARCH_KEY_SERPER',
    apiKeyUrl: 'https://serper.dev/api-key',
  },
  {
    id: 'brave',
    label: 'Brave Search',
    region: 'global',
    envKey: 'WEB_SEARCH_KEY_BRAVE',
    apiKeyUrl: 'https://brave.com/search/api/',
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
  env ? WEB_SEARCH_PROVIDERS.filter((p) => !!env[p.envKey]?.trim()) : [];

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
