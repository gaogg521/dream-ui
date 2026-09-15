#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `one-web-search` — the built-in web search MCP server.
 *
 * The app had no search at all: the dream engine ships nine tools and none of
 * them reaches the network, `ModelType::WebSearch` is only a UI label on a
 * model name, and the one networked path (`one-browser`) is browser automation
 * that expects the model to already know the URL. So a question about anything
 * recent had no way to be answered.
 *
 * One tool, `web_search`, backed by whichever vendor the user configured. The
 * alternative — pre-registering Tavily/Serper/Brave's own MCP packages — was
 * rejected because the Chinese providers have no MCP server at all, which would
 * have left two mechanisms with different tool names and result shapes, plus an
 * npx download on first call.
 *
 * Credentials arrive through the MCP entry's `transport.env`, one variable per
 * provider (see `common/webSearch/catalog.ts`). Nothing new is persisted: the
 * settings form writes that env and the backend hands it to this process.
 *
 * Unlike the other built-in servers this one needs no TCP bridge to the main
 * process — it calls the vendor's HTTPS API directly.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  WEB_SEARCH_MCP_NAME,
  WEB_SEARCH_PROVIDERS,
  configuredWebSearchProviders,
  resolveWebSearchBaseUrl,
  resolveWebSearchProvider,
  resolveWebSearchRoute,
  type WebSearchProvider,
} from '../../../common/webSearch/catalog';
import { runHostedSearch } from './hostedSearch';
import { WEB_SEARCH_ADAPTERS, runProviderSearch, type SearchHit } from './webSearchProviders';

const DEFAULT_COUNT = 8;
const MAX_COUNT = 20;
/** Long enough for a slow vendor, short enough that the model is not left hanging. */
const REQUEST_TIMEOUT_MS = 30_000;

const env = (): Record<string, string> => process.env as Record<string, string>;

/**
 * Told to the model when no key is configured.
 *
 * Deliberately says not to retry. A bare failure reads to a model as a
 * transient error and it will call the tool again — the same waste that made
 * `retryAdvice` necessary in `imageGenServer.ts`. Configuration is not
 * something the model can fix by trying harder, and the user is the only one
 * who can act, so the text names the exact place to go.
 */
const NOT_CONFIGURED = [
  'Web search is not configured yet, so no search was performed.',
  '',
  'This is a setup step, NOT a transient failure — do not retry this tool.',
  'Tell the user to open Settings → Tools → one-web-search, pick a search provider',
  'and paste its API key. Providers available:',
  WEB_SEARCH_PROVIDERS.map((p) => `  - ${p.label} (${p.apiKeyUrl})`).join('\n'),
  '',
  'Until then, answer from what you already know and say plainly that you could',
  'not check anything current.',
].join('\n');

/**
 * How much of a snippet is worth spending tokens on.
 *
 * Vendors differ wildly — Bocha's `snippet` runs to several hundred characters
 * of raw page text. Eight of those is a lot of context to spend on results the
 * model may not even cite.
 */
const SNIPPET_LIMIT = 280;

/**
 * Snippets and titles arrive carrying the source page's own line breaks.
 * Measured against Bocha with a real key: inside a numbered list every
 * continuation line then starts at column 0, so the entry boundaries become
 * invisible and the block reads as one run-on wall. Flatten to a single line
 * and let the leading indent do the grouping.
 */
const flatten = (text: string): string => {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > SNIPPET_LIMIT ? `${single.slice(0, SNIPPET_LIMIT)}…` : single;
};

/** Render hits for the model: ranked, each with the URL it can cite. */
const formatHits = (source: string, query: string, hits: SearchHit[]): string => {
  if (hits.length === 0) {
    return `No results from ${source} for "${query}". Try different wording, or a narrower query.`;
  }
  const lines = hits.map((hit, index) => {
    const date = hit.publishedAt ? ` (${hit.publishedAt})` : '';
    const snippet = hit.snippet ? `\n   ${flatten(hit.snippet)}` : '';
    return `[${index + 1}] ${flatten(hit.title)}${date}\n   ${hit.url}${snippet}`;
  });
  return [`${hits.length} result(s) from ${source} for "${query}":`, '', ...lines].join('\n');
};

/**
 * A failed HTTP call, described so the model does not misread it.
 *
 * An auth failure is the user's to fix and must not be retried; a rate limit or
 * a 5xx is worth one retry. Saying which is which here is the difference
 * between one wasted call and a loop.
 */
const describeHttpFailure = (provider: WebSearchProvider, status: number, body: string, endpoint: string): string => {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    /**
     * A 401 here does not always mean the key is bad. Doubao search was once
     * pointed at Volcengine Ark — a different product on a different host — and
     * Ark answered 401 to a perfectly valid key. The message said "key
     * rejected", which sent the search hunting for a credential problem that
     * did not exist. Naming the endpoint makes the other explanation visible.
     */
    return [
      `${provider.label} rejected the request (HTTP ${status}) at ${endpoint}.`,
      'Do NOT retry — retrying cannot fix either cause.',
      'Either the API key is wrong, expired or out of quota, OR that endpoint',
      'belongs to a different service than the key does — a host that does not',
      'serve this product answers 401 to a valid key too.',
      `Ask the user to check both in Settings → Tools → one-web-search${provider.apiKeyUrl ? ` (${provider.apiKeyUrl})` : ''}.`,
      detail && `Service said: ${detail}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (status === 429) {
    return `${provider.label} is rate limiting (HTTP 429). Wait a moment before trying again.\n${detail}`;
  }
  return `${provider.label} search failed with HTTP ${status}.\n${detail}`;
};

/**
 * Label for hosted results. Deliberately not the vendor name: the user did not
 * choose Tavily, and naming it would imply a relationship (and a quota) that
 * is ours, not theirs.
 */
const HOSTED_LABEL = 'built-in web search';

/**
 * A hosted search that did not return results.
 *
 * The distinction that matters is whether the user can do anything. Running
 * out of the day's free allowance is fixable — by waiting, or by adding their
 * own key — and saying so is the difference between a dead end and a next
 * step. A broker outage is not the user's to fix and must not send them
 * hunting through settings.
 */
const describeHostedFailure = (errorCode: string | undefined, status: number | undefined, detail: string): string => {
  if (errorCode === 'search_quota_exhausted') {
    return [
      'The built-in web search has used up this device’s free allowance for today.',
      'Do NOT retry — the allowance resets at 00:00 UTC.',
      'Tell the user they can keep searching right away by adding their own provider',
      'API key in Settings → Tools → one-web-search, which has no such limit.',
      'Until then, answer from what you already know and say you could not check anything current.',
    ].join('\n');
  }
  if (errorCode === 'search_budget_exhausted' || errorCode === 'search_unavailable') {
    return [
      'The built-in web search is unavailable right now (the shared daily capacity is spent,',
      'or the service is switched off).',
      'Do NOT retry — this is not a transient network error.',
      'Tell the user they can search immediately with their own provider API key in',
      'Settings → Tools → one-web-search.',
    ].join('\n');
  }
  if (errorCode === 'rate_limited' || status === 429) {
    return 'The built-in web search is rate limiting this connection. Wait a moment before trying again.';
  }
  return `The built-in web search could not be reached${status ? ` (HTTP ${status})` : ''}.\n${detail.slice(0, 300)}`;
};

async function runHosted(
  endpoint: string,
  installId: string,
  query: string,
  count: number
): Promise<{ text: string; isError: boolean }> {
  const outcome = await runHostedSearch(endpoint, installId, query, count, REQUEST_TIMEOUT_MS);
  if (outcome.ok) {
    return { text: formatHits(HOSTED_LABEL, query, outcome.hits || []), isError: false };
  }
  return {
    text: describeHostedFailure(outcome.errorCode, outcome.status, outcome.detail || ''),
    isError: true,
  };
}

async function runSearch(query: string, count: number): Promise<{ text: string; isError: boolean }> {
  const current = env();
  const route = resolveWebSearchRoute(current);

  // A key the user configured always wins: it is their quota, usually a larger
  // one, and it costs us nothing. The hosted path is the floor, not the
  // ceiling.
  if (!route.provider) {
    if (route.hostedEndpoint) return runHosted(route.hostedEndpoint, route.installId, query, count);
    return { text: NOT_CONFIGURED, isError: true };
  }
  const provider = route.provider;

  const adapter = WEB_SEARCH_ADAPTERS[provider.id];
  if (!adapter) {
    // Only reachable if the catalog gains a provider before its adapter.
    return { text: `No adapter is implemented for provider "${provider.id}".`, isError: true };
  }

  const apiKey = current[provider.envKey]?.trim();
  if (!apiKey) return { text: NOT_CONFIGURED, isError: true };

  const endpoint = resolveWebSearchBaseUrl(provider, current);
  const outcome = await runProviderSearch(adapter, apiKey, endpoint, query, count, REQUEST_TIMEOUT_MS, current);

  if (outcome.ok) {
    return { text: formatHits(provider.label, query, outcome.hits || []), isError: false };
  }

  const detail = outcome.body ?? '';
  if (outcome.reason === 'http') {
    return { text: describeHttpFailure(provider, outcome.status ?? 0, detail, endpoint), isError: true };
  }
  if (outcome.reason === 'badJson') {
    return {
      text: `${provider.label} returned a non-JSON response:
${detail.slice(0, 300)}`,
      isError: true,
    };
  }
  if (outcome.reason === 'timeout') {
    return { text: `${provider.label} did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`, isError: true };
  }
  return { text: `Could not reach ${provider.label}: ${detail || 'unknown error'}`, isError: true };
}

async function main() {
  const server = new McpServer({ name: WEB_SEARCH_MCP_NAME, version: '1.0.0' });

  server.tool(
    'web_search',
    'Search the live web and get back ranked results with titles, URLs and snippets. ' +
      'Use this whenever the answer depends on current information — news, prices, releases, ' +
      'documentation, anything that may have changed since training. ' +
      'Cite the URLs you actually used. Returns plain text; an empty result means the query found nothing, not that the tool failed.',
    {
      query: z.string().describe('What to search for. A natural-language question works.'),
      count: z
        .number()
        .int()
        .min(1)
        .max(MAX_COUNT)
        .optional()
        .describe(`How many results to return (1-${MAX_COUNT}, default ${DEFAULT_COUNT}).`),
    },
    async ({ query, count }) => {
      const { text, isError } = await runSearch(query, Math.min(count ?? DEFAULT_COUNT, MAX_COUNT));
      return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const configured = configuredWebSearchProviders(env());
  const active = resolveWebSearchProvider(env());
  const route = resolveWebSearchRoute(env());
  // Which of the three states this process is in is the first thing anyone
  // debugging "search did nothing" needs, and stderr is the only channel a
  // stdio MCP has that does not corrupt the protocol.
  const source = active?.id ?? (route.hostedEndpoint ? 'hosted' : 'none');
  process.stderr.write(`[web-search-mcp] ready; ${configured.length} provider(s) configured, active: ${source}\n`);
}

main().catch((err) => {
  process.stderr.write(`[web-search-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
