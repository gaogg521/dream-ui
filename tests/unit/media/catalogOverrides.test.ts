/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCatalogOverridesJson,
  isMediaGenSupported,
  parseCatalogOverrides,
  resolveMediaModelSpec,
  setUserMediaModelSpecs,
} from '@/common/media/catalog';

const gateway = { platform: 'openai', base_url: 'https://gw.example.com/v1', name: 'Gateway' };

afterEach(() => {
  // The registry is process-wide; leaking entries between cases would make
  // later assertions lie about the built-in catalog.
  setUserMediaModelSpecs([]);
});

describe('parseCatalogOverrides', () => {
  it('accepts a minimal image entry', () => {
    const { specs, errors } = parseCatalogOverrides(
      JSON.stringify([{ id: 'my-flux', kind: 'image', form: 'A', match: { model: 'flux-pro-ultra' } }])
    );
    expect(errors).toEqual([]);
    expect(specs).toHaveLength(1);
    expect(specs[0].id).toBe('my-flux');
  });

  it('accepts a single object as well as an array', () => {
    const { specs } = parseCatalogOverrides(
      JSON.stringify({ id: 'solo', kind: 'image', form: 'A', match: { model: 'x' } })
    );
    expect(specs).toHaveLength(1);
  });

  it('understands /regex/ and name lists', () => {
    const { specs } = parseCatalogOverrides(
      JSON.stringify([
        { id: 'r', kind: 'image', form: 'A', match: { model: '/^my-flux-.+/i' } },
        { id: 'l', kind: 'image', form: 'A', match: { model: ['a-1', 'a-2'] } },
      ])
    );
    expect(specs[0].match.model).toBeInstanceOf(RegExp);
    expect(specs[1].match.model).toEqual(['a-1', 'a-2']);
  });

  // ⚠️ The invariant the whole gate exists for: config must not be able to make
  // a model selectable that no driver can execute.
  it('refuses a Form C entry naming an endpoint style with no driver', () => {
    const { specs, errors } = parseCatalogOverrides(
      JSON.stringify([{ id: 'bad', kind: 'video', form: 'C', endpointStyle: 'runway', match: { model: 'gen-4' } }])
    );
    expect(specs).toEqual([]);
    expect(errors[0]).toContain('endpointStyle');
  });

  it('refuses a Form C entry with no endpoint style at all', () => {
    const { specs, errors } = parseCatalogOverrides(
      JSON.stringify([{ id: 'bad2', kind: 'video', form: 'C', match: { model: 'x' } }])
    );
    expect(specs).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('accepts a Form C entry on an implemented driver and fills polling defaults', () => {
    const { specs, errors } = parseCatalogOverrides(
      JSON.stringify([
        { id: 'gw-seedance', kind: 'video', form: 'C', endpointStyle: 'ark-task', match: { model: 'my-dance' } },
      ])
    );
    expect(errors).toEqual([]);
    // Form C without polling bounds would spin forever.
    expect(specs[0].polling?.intervalMs).toBeGreaterThan(0);
    expect(specs[0].polling?.timeoutMs).toBeGreaterThan(0);
  });

  // One typo should not silently disable every model the user added.
  it('skips only the bad entries and reports why', () => {
    const { specs, errors } = parseCatalogOverrides(
      JSON.stringify([
        { id: 'good', kind: 'image', form: 'A', match: { model: 'ok-1' } },
        { kind: 'image', form: 'A', match: { model: 'no-id' } },
        { id: 'bad-kind', kind: 'audio', form: 'A', match: { model: 'x' } },
        { id: 'bad-form', kind: 'image', form: 'Z', match: { model: 'x' } },
        { id: 'no-model', kind: 'image', form: 'A' },
      ])
    );
    expect(specs.map((s) => s.id)).toEqual(['good']);
    expect(errors).toHaveLength(4);
    expect(errors.join(' ')).toContain('"id" is required');
  });

  it('reports malformed JSON instead of throwing', () => {
    const { specs, errors } = parseCatalogOverrides('{not json');
    expect(specs).toEqual([]);
    expect(errors[0]).toContain('Not valid JSON');
  });

  it('treats empty input as no overrides', () => {
    expect(parseCatalogOverrides('')).toEqual({ specs: [], errors: [] });
    expect(parseCatalogOverrides('   ')).toEqual({ specs: [], errors: [] });
  });
});

describe('override resolution', () => {
  // The actual point: a gateway model the built-in catalog never heard of.
  // Ideogram is deliberately absent from the built-ins, so it is a real
  // stand-in for "whatever my gateway turned on this week".
  it('makes an unknown gateway model usable', () => {
    expect(isMediaGenSupported('image', gateway, 'ideogram-v3-turbo')).toBe(false);

    applyCatalogOverridesJson(
      JSON.stringify([
        {
          id: 'my-ideogram',
          kind: 'image',
          form: 'A',
          match: { model: '/^ideogram-/i' },
          params: { sizes: ['1024x1024'], maxN: 4 },
        },
      ])
    );

    expect(isMediaGenSupported('image', gateway, 'ideogram-v3-turbo')).toBe(true);
    expect(resolveMediaModelSpec('image', gateway, 'ideogram-v3-turbo')?.id).toBe('my-ideogram');
  });

  it('lets a user entry override a built-in of the same id', () => {
    const openai = { platform: 'openai', base_url: 'https://api.openai.com/v1', name: 'OpenAI' };
    expect(resolveMediaModelSpec('image', openai, 'dall-e-3')?.id).toBe('openai-dall-e-3');

    applyCatalogOverridesJson(
      JSON.stringify([
        {
          id: 'openai-dall-e-3',
          kind: 'image',
          form: 'A',
          match: { model: 'dall-e-3' },
          params: { sizes: ['512x512'] },
        },
      ])
    );

    const spec = resolveMediaModelSpec('image', openai, 'dall-e-3');
    expect(spec?.id).toBe('openai-dall-e-3');
    // The user's declaration wins, and the built-in is replaced rather than
    // left sitting behind it as a duplicate.
    expect(spec?.params.sizes).toEqual(['512x512']);
  });

  it('leaves the built-in catalog untouched when there are no overrides', () => {
    const openai = { platform: 'openai', base_url: 'https://api.openai.com/v1', name: 'OpenAI' };
    applyCatalogOverridesJson('');
    expect(resolveMediaModelSpec('image', openai, 'dall-e-3')?.id).toBe('openai-dall-e-3');
    expect(isMediaGenSupported('image', openai, 'not-a-real-model')).toBe(false);
  });

  it('scopes overrides to their own kind', () => {
    applyCatalogOverridesJson(
      JSON.stringify([{ id: 'vid-only', kind: 'video', form: 'C', endpointStyle: 'ark-task', match: { model: 'zz' } }])
    );
    expect(isMediaGenSupported('video', gateway, 'zz')).toBe(true);
    // The same name must not become an image model just because an entry exists.
    expect(isMediaGenSupported('image', gateway, 'zz')).toBe(false);
  });
});
