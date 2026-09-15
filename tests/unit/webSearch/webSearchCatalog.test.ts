/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which provider a search actually runs against.
 *
 * Both the settings form and the MCP process answer this question, and they
 * must answer it identically — if they disagree, the UI shows a radio button on
 * one provider while searches quietly go to another, which is close to
 * impossible to diagnose from the outside. That is why the logic lives in one
 * pure module rather than being written twice.
 */

import { describe, expect, it } from 'vitest';
import {
  WEB_SEARCH_DEFAULT_ENV,
  WEB_SEARCH_PROVIDERS,
  configuredWebSearchProviders,
  getWebSearchProvider,
  resolveWebSearchProvider,
} from '@/common/webSearch/catalog';

const keyOf = (id: string) => WEB_SEARCH_PROVIDERS.find((p) => p.id === id)!.envKey;

describe('web search provider catalog', () => {
  it('gives every provider a distinct id and env key', () => {
    const ids = WEB_SEARCH_PROVIDERS.map((p) => p.id);
    const envKeys = WEB_SEARCH_PROVIDERS.map((p) => p.envKey);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(envKeys).size).toBe(envKeys.length);
    // Ids are persisted in the MCP entry's env; a rename strands a user's key.
    expect(ids).toContain('bocha');
  });

  it('points every provider at a page where a key can actually be obtained', () => {
    for (const provider of WEB_SEARCH_PROVIDERS) {
      expect(provider.apiKeyUrl, provider.id).toMatch(/^https:\/\//);
    }
  });

  it('treats an unknown id as no provider rather than throwing', () => {
    expect(getWebSearchProvider('does-not-exist')).toBeUndefined();
    expect(getWebSearchProvider(undefined)).toBeUndefined();
  });
});

describe('resolveWebSearchProvider', () => {
  it('returns nothing when no key is configured', () => {
    expect(resolveWebSearchProvider(undefined)).toBeUndefined();
    expect(resolveWebSearchProvider({})).toBeUndefined();
    // Whitespace is not a key.
    expect(resolveWebSearchProvider({ [keyOf('bocha')]: '   ' })).toBeUndefined();
  });

  it('uses the only configured provider without being told to', () => {
    expect(resolveWebSearchProvider({ [keyOf('tavily')]: 'k' })?.id).toBe('tavily');
  });

  it('honours the stored default when several are configured', () => {
    const env = {
      [keyOf('bocha')]: 'k1',
      [keyOf('serper')]: 'k2',
      [WEB_SEARCH_DEFAULT_ENV]: 'serper',
    };
    expect(resolveWebSearchProvider(env)?.id).toBe('serper');
  });

  /**
   * The case that turns a stale radio button into failing searches: the user
   * clears the key of whichever provider was the default. Falling back to
   * another configured one keeps search working; honouring the dead default
   * would fail every call with "rejected the API key" and point the user at a
   * provider they had deliberately emptied.
   */
  it('falls back when the default has lost its key', () => {
    const env = {
      [keyOf('bocha')]: 'k1',
      [WEB_SEARCH_DEFAULT_ENV]: 'serper',
    };
    expect(resolveWebSearchProvider(env)?.id).toBe('bocha');
  });

  it('ignores a default naming a provider that does not exist', () => {
    const env = { [keyOf('bocha')]: 'k1', [WEB_SEARCH_DEFAULT_ENV]: 'not-a-provider' };
    expect(resolveWebSearchProvider(env)?.id).toBe('bocha');
  });
});

describe('configuredWebSearchProviders', () => {
  it('lists only providers with a non-empty key, in catalog order', () => {
    const env = { [keyOf('brave')]: 'k', [keyOf('bocha')]: 'k', [keyOf('serper')]: '' };
    const ids = configuredWebSearchProviders(env).map((p) => p.id);
    expect(ids).toEqual(['bocha', 'brave']);
  });
});
