/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Search run by the company broker, for users who have configured no key.
 *
 * Everything in `webSearchProviders.ts` assumes the user brings their own
 * credential. Most will not, and a feature that requires a vendor signup
 * before it does anything is a feature almost nobody has. The obvious fix —
 * bundling our own Tavily key into the app — does not survive inspection:
 * dream-ui is a public repository and an Electron `asar` is a readable
 * archive, so a shipped key is a published key. It gets scanned, revoked, and
 * search then breaks for every user at once, with no way to rotate short of a
 * release.
 *
 * So the key stays on `dream-trial-broker` (mode C, `POST /v1/search`) and
 * this sends only a query and the install id the broker meters against. The
 * response comes back already normalised into the same {@link SearchHit} shape
 * the vendor adapters produce, so the caller renders it identically and the
 * model cannot tell which path served it.
 */

import type { SearchHit } from './webSearchProviders';

/**
 * Outcome of one hosted search.
 *
 * Flat with optional fields, matching `SearchOutcome` and for the same reason:
 * this project compiles without `strictNullChecks`, so a union tagged by a
 * literal boolean does not narrow and every field access after the guard fails
 * to compile.
 */
export type HostedSearchOutcome = {
  ok: boolean;
  hits?: SearchHit[];
  /** Broker error code (`search_quota_exhausted`, `search_unavailable`, …). */
  errorCode?: string;
  status?: number;
  /** Free-text detail for the log/message when there is no error code. */
  detail?: string;
  /** Searches left today on this device, when the broker reported it. */
  remainingToday?: number;
};

type BrokerHit = {
  title?: string;
  url?: string;
  snippet?: string;
  published_at?: string;
};

/** The broker already normalises; this only renames `published_at`. */
const toHit = (raw: BrokerHit): SearchHit | undefined => {
  const url = typeof raw?.url === 'string' ? raw.url.trim() : '';
  if (!url) return undefined;
  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : url,
    url,
    snippet: typeof raw.snippet === 'string' ? raw.snippet : '',
    ...(typeof raw.published_at === 'string' && raw.published_at ? { publishedAt: raw.published_at } : {}),
  };
};

export const runHostedSearch = async (
  endpoint: string,
  installId: string,
  query: string,
  count: number,
  timeoutMs: number
): Promise<HostedSearchOutcome> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ install_id: installId, query, count }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // A non-JSON body from the broker means something in front of it
      // answered — a proxy error page, a captive portal. Keep the text: it is
      // the only clue about what actually replied.
      return { ok: false, status: response.status, detail: raw.slice(0, 300) };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        errorCode: typeof payload.error === 'string' ? payload.error : undefined,
        detail: raw.slice(0, 300),
      };
    }

    const results = Array.isArray(payload.results) ? (payload.results as BrokerHit[]) : [];
    const quota = payload.quota as { remaining?: number } | undefined;
    return {
      ok: true,
      hits: results.map(toHit).filter((hit): hit is SearchHit => !!hit),
      ...(typeof quota?.remaining === 'number' ? { remainingToday: quota.remaining } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: message.includes('abort') ? `timed out after ${timeoutMs}ms` : message };
  } finally {
    clearTimeout(timer);
  }
};
