/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  declaredModelKindByName,
  declaredModelKindOf,
  isChatCapableModel,
  inferredModelKinds,
  modelKindLabelOf,
} from '@/common/utils/modelCapabilities';
import { inferModelKindFromName } from '@/common/media/catalog';
import type { IProvider } from '@/common/config/storage';

const provider = (
  id: string,
  settings: IProvider['model_settings']
): Pick<IProvider, 'model_settings'> & { id: string } => ({
  id,
  model_settings: settings,
});

describe('declaredModelKindOf', () => {
  it('returns the kind the user declared for that model', () => {
    const p = provider('a', { 'gpt-image-2': { model_kind: 'image' } });
    expect(declaredModelKindOf(p, 'gpt-image-2')).toBe('image');
  });

  // Undeclared but known to the built-in catalog still gets a kind. The
  // catalog is not the removed name whitelist: it is the same data-driven
  // table the execution path consults, and it matches provider + model.
  it('falls back to the built-in catalog for a model it recognizes', () => {
    expect(declaredModelKindOf(provider('a', {}), 'gpt-image-2')).toBe('image');
    expect(declaredModelKindOf(provider('a', {}), 'seedance-2-0-pro')).toBe('video');
  });

  // A declaration outranks the catalog — that is the whole point of letting
  // the user say what the model in front of them actually is.
  it('lets a declaration override what the catalog thinks', () => {
    const p = provider('a', { 'gpt-image-2': { model_kind: 'text' } });
    expect(declaredModelKindOf(p, 'gpt-image-2')).toBe('text');
  });

  // Neither source knows: show nothing rather than infer from the name.
  it('returns undefined when neither the user nor the catalog knows', () => {
    const p = provider('a', { other: { model_kind: 'video' } });
    expect(declaredModelKindOf(p, 'kimi-k2-6')).toBeUndefined();
    expect(declaredModelKindOf(undefined, 'kimi-k2-6')).toBeUndefined();
    expect(declaredModelKindOf(p, undefined)).toBeUndefined();
  });
});

describe('modelKindLabelOf', () => {
  it('marks a catalog or declared kind as not inferred', () => {
    expect(modelKindLabelOf(provider('a', {}), 'gpt-image-2')).toEqual({ kind: 'image', inferred: false });
    expect(modelKindLabelOf(provider('a', { m: { model_kind: 'audio' } }), 'm')).toEqual({
      kind: 'audio',
      inferred: false,
    });
  });

  // Reading the name is allowed for a *label* — the worst case is a wrong word
  // the user can correct. It is never allowed for a decision: that was the
  // whitelist removed on 2026-08-06, where a missed pattern made a model
  // unusable until someone shipped code.
  it('reads the name when nothing authoritative knows, and says it guessed', () => {
    expect(modelKindLabelOf(provider('a', {}), 'gemini-3-pro-image')).toEqual({ kind: 'image', inferred: true });
    expect(modelKindLabelOf(provider('a', {}), 'kimi-k2-6')).toEqual({ kind: 'text', inferred: true });
  });

  it('leaves embeddings and rerankers unlabelled rather than calling them text', () => {
    expect(modelKindLabelOf(provider('a', {}), 'text-embedding-3-large').kind).toBeUndefined();
    expect(modelKindLabelOf(provider('a', {}), 'bge-reranker-v2').kind).toBeUndefined();
  });

  // The whole point of the split: a guessed label must not move a model in or
  // out of a picker.
  it('never lets an inferred label change what the model may be used for', () => {
    const p = provider('a', {});
    expect(modelKindLabelOf(p, 'gemini-3-pro-image')).toEqual({ kind: 'image', inferred: true });
    expect(isChatCapableModel(p, 'gemini-3-pro-image')).toBe(true);
    expect(declaredModelKindOf(p, 'gemini-3-pro-image')).toBeUndefined();
  });
});

describe('inferModelKindFromName', () => {
  it('reads the obvious media names', () => {
    expect(inferModelKindFromName('seedance-2-0-pro')).toBe('video');
    expect(inferModelKindFromName('sora-2')).toBe('video');
    expect(inferModelKindFromName('dall-e-3')).toBe('image');
    expect(inferModelKindFromName('doubao-seedream-5-0-pro')).toBe('image');
    expect(inferModelKindFromName('qwen-audio-turbo')).toBe('audio');
    expect(inferModelKindFromName('qwen-vl-max')).toBe('multimodal');
  });

  it('falls back to text for an ordinary chat model', () => {
    expect(inferModelKindFromName('deepseek-v4-flash')).toBe('text');
  });
});

describe('isChatCapableModel', () => {
  // The regex this replaced hid `gemini-3-pro-image` (a chat model that
  // answers with pictures) and offered `seedance-2-0-pro` (no chat endpoint at
  // all — a message to it comes back `404 model not found`). Both directions
  // are pinned here.
  it('keeps a video model out of the conversation picker', () => {
    expect(isChatCapableModel(provider('a', {}), 'seedance-2-0-pro')).toBe(false);
    expect(isChatCapableModel(provider('a', { m: { model_kind: 'video' } }), 'm')).toBe(false);
  });

  it('keeps a dedicated image endpoint out of the conversation picker', () => {
    expect(isChatCapableModel(provider('a', {}), 'gpt-image-2')).toBe(false);
  });

  it('offers a model whose name looks like an image model but is not identified', () => {
    // `gemini-3-pro-image` on an OpenAI-compatible provider is not claimed by
    // the catalog, so it stays available for chat — which is what it does.
    expect(isChatCapableModel(provider('a', {}), 'gemini-3-pro-image')).toBe(true);
  });

  it('offers ordinary and undeclared models', () => {
    expect(isChatCapableModel(provider('a', {}), 'kimi-k2-6')).toBe(true);
    expect(isChatCapableModel(provider('a', { m: { model_kind: 'text' } }), 'm')).toBe(true);
    expect(isChatCapableModel(provider('a', { m: { model_kind: 'multimodal' } }), 'm')).toBe(true);
  });

  it('keeps an audio model out of the conversation picker', () => {
    expect(isChatCapableModel(provider('a', { m: { model_kind: 'audio' } }), 'm')).toBe(false);
  });
});

describe('declaredModelKindByName', () => {
  it('finds a kind declared on any provider', () => {
    const providers = [provider('a', {}), provider('b', { 'seedream-4': { model_kind: 'image' } })];
    expect(declaredModelKindByName(providers, 'seedream-4')).toBe('image');
  });

  // The ACP list only carries a model name, so a match across providers is a
  // guess about identity. When two providers disagree there is no way to tell
  // which one the CLI means, and a confidently wrong tag is the failure mode
  // this whole feature exists to prevent.
  it('refuses to answer when providers disagree about the same name', () => {
    const providers = [
      provider('a', { 'shared-name': { model_kind: 'image' } }),
      provider('b', { 'shared-name': { model_kind: 'text' } }),
    ];
    expect(declaredModelKindByName(providers, 'shared-name')).toBeUndefined();
  });

  it('still answers when providers agree', () => {
    const providers = [
      provider('a', { 'shared-name': { model_kind: 'video' } }),
      provider('b', { 'shared-name': { model_kind: 'video' } }),
    ];
    expect(declaredModelKindByName(providers, 'shared-name')).toBe('video');
  });

  it('returns undefined for an unknown name or an empty provider list', () => {
    expect(declaredModelKindByName([provider('a', { x: { model_kind: 'image' } })], 'y')).toBeUndefined();
    expect(declaredModelKindByName([], 'x')).toBeUndefined();
    expect(declaredModelKindByName(undefined, 'x')).toBeUndefined();
  });
});

/**
 * Backs the "accept the guessed kinds" bulk action. What matters is that it
 * offers up *only* genuine guesses: sweeping a declared or catalogued kind into
 * that action would rewrite a decision the user (or the catalog) already made,
 * and doing it in bulk means they would never notice.
 */
describe('inferredModelKinds', () => {
  it('lists models whose kind was read off the name', () => {
    const p = { models: ['some-image-thing'], model_settings: {} };
    expect(inferredModelKinds(p)).toEqual([
      { model: 'some-image-thing', kind: inferModelKindFromName('some-image-thing') },
    ]);
  });

  it('leaves a kind the user already declared alone', () => {
    const p = { models: ['gpt-image-2'], model_settings: { 'gpt-image-2': { model_kind: 'video' as const } } };
    expect(inferredModelKinds(p)).toEqual([]);
  });

  it('leaves a model the catalog resolves alone', () => {
    // gpt-image-2 is a catalog entry, so its kind is known rather than guessed.
    const p = { models: ['gpt-image-2'], model_settings: {} };
    expect(inferredModelKinds(p).some((entry) => entry.model === 'gpt-image-2')).toBe(false);
  });

  /**
   * Embeddings and rerankers are none of the five kinds, so there is nothing to
   * accept — offering one would push the user to declare a model as something
   * it is not.
   */
  it('skips a model that is none of the kinds', () => {
    const p = { models: ['text-embedding-3-large'], model_settings: {} };
    expect(inferredModelKinds(p)).toEqual([]);
  });

  /**
   * An unreadable chat-ish name falls back to `text`, and that IS offered: the
   * confirm dialog is where the user asserts it, which is the only thing that
   * ever turns a guess into a declaration. Declaring it changes no behaviour —
   * text and undeclared are both chat-capable and neither can generate media —
   * so the whole effect is that the list stops hedging.
   */
  it('offers the text fallback, because accepting it is the user asserting it', () => {
    const p = { models: ['mystery-model-1'], model_settings: {} };
    expect(inferredModelKinds(p)).toEqual([{ model: 'mystery-model-1', kind: 'text' }]);
  });

  it('returns nothing for a provider with no models', () => {
    expect(inferredModelKinds({ models: [], model_settings: {} })).toEqual([]);
    expect(inferredModelKinds(undefined)).toEqual([]);
  });
});
