/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Declaring a model as image/video is how the product asks users to configure
 * media generation. Everything downstream, however, used to read only the older
 * `tools.*GenerationModel` settings keys — so a declared model was invisible to
 * an agent: the media MCP stayed disabled, and the tool, if reached at all,
 * answered "no model is configured".
 *
 * These tests pin the fallback that closes that gap. They use catalog models
 * rather than hand-written `model_kind` values so that support tracks the same
 * predicate the rest of the app uses.
 */

import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import { findDeclaredMediaModel, hasDeclaredMediaModel, listMediaModels } from '@/common/media/declaredModel';

const provider = (over: Partial<IProvider> & { models: string[] }): IProvider =>
  ({
    id: over.id ?? 'p-1',
    name: over.name ?? 'Gateway',
    platform: over.platform ?? 'openai',
    base_url: over.base_url ?? 'https://example.invalid/v1',
    api_key: 'k',
    ...over,
  }) as IProvider;

const CHAT_ONLY = provider({ id: 'chat', models: ['deepseek-v4-flash', 'kimi-k2-6'] });
const VIDEO = provider({ id: 'vid', name: 'Ark', platform: 'openai', models: ['doubao-seedance-1-0-pro'] });
const IMAGE = provider({
  id: 'img',
  name: 'OpenAI',
  platform: 'openai',
  base_url: 'https://api.openai.com/v1',
  models: ['gpt-image-1', 'dall-e-3'],
});

describe('findDeclaredMediaModel', () => {
  it('finds a declared video model when nothing is picked in settings', () => {
    const found = findDeclaredMediaModel('video', [CHAT_ONLY, VIDEO]);
    expect(found).toMatchObject({ id: 'vid', use_model: 'doubao-seedance-1-0-pro' });
  });

  /**
   * The kinds must not bleed into each other: answering an image request with a
   * video model would fail deep inside an adapter instead of at the point where
   * the mismatch is obvious.
   */
  it('does not offer a video model for an image request', () => {
    expect(findDeclaredMediaModel('image', [VIDEO])).toBeUndefined();
  });

  it('returns nothing when the user only has chat models', () => {
    expect(findDeclaredMediaModel('video', [CHAT_ONLY])).toBeUndefined();
    expect(findDeclaredMediaModel('image', [CHAT_ONLY])).toBeUndefined();
  });

  it('survives an empty or missing provider list', () => {
    expect(findDeclaredMediaModel('image', [])).toBeUndefined();
    expect(findDeclaredMediaModel('image', undefined)).toBeUndefined();
  });

  // Shaped as the selection the resolver consumes: credentials are re-read from
  // the provider at run time, so carrying them here would be copies to go stale.
  it('returns a selection carrying no credentials', () => {
    const found = findDeclaredMediaModel('video', [VIDEO]);
    expect(found?.api_key).toBe('');
    expect(found?.base_url).toBe('');
  });
});

describe('listMediaModels', () => {
  it('lists every model of the kind, across providers, in order', () => {
    const list = listMediaModels('image', [CHAT_ONLY, IMAGE, VIDEO]);
    expect(list.map((m) => m.model)).toEqual(['gpt-image-1', 'dall-e-3']);
    expect(list[0]).toMatchObject({ providerId: 'img', providerName: 'OpenAI', platform: 'openai' });
  });

  it('does not cross image and video', () => {
    expect(listMediaModels('video', [IMAGE]).length).toBe(0);
    expect(listMediaModels('image', [VIDEO]).length).toBe(0);
  });

  it('is empty-list and undefined safe', () => {
    expect(listMediaModels('image', [])).toEqual([]);
    expect(listMediaModels('video', undefined)).toEqual([]);
  });

  it('agrees with findDeclaredMediaModel on the first match', () => {
    const first = listMediaModels('video', [CHAT_ONLY, VIDEO])[0];
    const found = findDeclaredMediaModel('video', [CHAT_ONLY, VIDEO]);
    expect(found).toMatchObject({ id: first.providerId, use_model: first.model });
  });
});

describe('hasDeclaredMediaModel', () => {
  /**
   * This is what decides whether the built-in media MCP is worth enabling. A
   * user with only chat models must not get media tools they cannot run.
   */
  it('is false when no media model is declared', () => {
    expect(hasDeclaredMediaModel([CHAT_ONLY])).toBe(false);
    expect(hasDeclaredMediaModel([])).toBe(false);
    expect(hasDeclaredMediaModel(undefined)).toBe(false);
  });

  it('is true as soon as one kind is available', () => {
    expect(hasDeclaredMediaModel([CHAT_ONLY, VIDEO])).toBe(true);
  });
});
