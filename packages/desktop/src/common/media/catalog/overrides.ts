/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * User-supplied catalog entries.
 *
 * The built-in catalog can only know models that existed when the app shipped,
 * while the people most affected by media coverage run OpenAI-compatible
 * gateways (new-api / one-api / an internal LiteLLM) hosting whatever models
 * their vendor turned on this week. Without an escape hatch, every one of those
 * is unreachable until we ship a release — which is exactly the "our model
 * coverage is a weak spot" complaint the catalog was built to end.
 *
 * Merge semantics: user entries are consulted **before** the built-ins and
 * matched by the same rules, so an entry either overrides a built-in (same
 * `id`) or adds a new one.
 *
 * ⚠️ Validation deliberately enforces the same invariant the built-in catalog
 * does: an entry may not name a Form C `endpointStyle` that has no driver. That
 * check is what stops "selectable but not executable" drift, and letting user
 * config bypass it would reintroduce exactly the failure the gate exists to
 * prevent — a model that appears in the picker and only fails at call time.
 *
 * Renderer-safe: no Node.js imports.
 */

import type { CatalogApiForm, CatalogMediaKind, MediaModelSpec } from './types';
import { IMPLEMENTED_ENDPOINT_STYLES } from './resolve';
import { setUserMediaModelSpecs } from './userSpecs';

export type OverrideParseResult = {
  specs: MediaModelSpec[];
  /** Human-readable problems; a non-empty list means some entries were skipped. */
  errors: string[];
};

const KINDS = new Set<CatalogMediaKind>(['image', 'video']);
const FORMS = new Set<CatalogApiForm>(['A', 'B', 'C']);

/** `/foo/i` → RegExp; anything else is treated as an exact (case-insensitive) name. */
const parseModelMatch = (value: unknown): string | string[] | RegExp | null => {
  if (Array.isArray(value)) {
    const names = value.filter((item): item is string => typeof item === 'string' && !!item.trim());
    return names.length > 0 ? names : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;

  const asRegex = /^\/(.+)\/([gimsuy]*)$/.exec(value.trim());
  if (asRegex) {
    try {
      return new RegExp(asRegex[1], asRegex[2]);
    } catch {
      // Fall through: an unparseable pattern is more useful as a literal name
      // than as a hard failure of the whole file.
      return value.trim();
    }
  }
  return value.trim();
};

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((item): item is string => typeof item === 'string');
  return out.length > 0 ? out : undefined;
};

const asPositiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;

const asBool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/**
 * Parse the user's JSON into catalog entries.
 *
 * Invalid entries are skipped with a reason rather than rejecting the whole
 * file: one typo should not silently disable every model the user added.
 */
export const parseCatalogOverrides = (raw: string): OverrideParseResult => {
  const text = (raw || '').trim();
  if (!text) return { specs: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { specs: [], errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const specs: MediaModelSpec[] = [];
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    const label = `entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${label}: not an object`);
      return;
    }
    const row = entry as Record<string, unknown>;

    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : '';
    if (!id) {
      errors.push(`${label}: "id" is required`);
      return;
    }

    const kind = row.kind as CatalogMediaKind;
    if (!KINDS.has(kind)) {
      errors.push(`${label} (${id}): "kind" must be "image" or "video"`);
      return;
    }

    const form = row.form as CatalogApiForm;
    if (!FORMS.has(form)) {
      errors.push(`${label} (${id}): "form" must be "A", "B" or "C"`);
      return;
    }

    const match = (row.match || {}) as Record<string, unknown>;
    const model = parseModelMatch(match.model);
    if (!model) {
      errors.push(`${label} (${id}): "match.model" is required (a name, a list of names, or /regex/)`);
      return;
    }

    const endpointStyle = typeof row.endpointStyle === 'string' ? row.endpointStyle.trim() : undefined;
    if (form === 'C') {
      // The invariant: no driver, no offer. Naming an unimplemented style here
      // would put a model in the picker that can only fail at call time.
      if (!endpointStyle || !IMPLEMENTED_ENDPOINT_STYLES.includes(endpointStyle)) {
        errors.push(
          `${label} (${id}): form "C" needs an "endpointStyle" with a driver — one of ${IMPLEMENTED_ENDPOINT_STYLES.join(', ')}`
        );
        return;
      }
    }

    const params = (row.params || {}) as Record<string, unknown>;
    const defaults = (row.defaults || {}) as Record<string, unknown>;
    const polling = (row.polling || {}) as Record<string, unknown>;

    specs.push({
      id,
      kind,
      form,
      endpointStyle,
      match: {
        model,
        platform: asStringArray(match.platform),
        baseUrlIncludes: asStringArray(match.baseUrlIncludes),
        providerNameIncludes: asStringArray(match.providerNameIncludes),
        requireOpenAiCompatible: asBool(match.requireOpenAiCompatible),
      },
      params: {
        sizes: asStringArray(params.sizes),
        aspectRatios: asStringArray(params.aspectRatios),
        qualities: asStringArray(params.qualities),
        maxN: asPositiveInt(params.maxN),
        seed: asBool(params.seed),
        negativePrompt: asBool(params.negativePrompt),
        imageInput: asBool(params.imageInput),
        durations: Array.isArray(params.durations)
          ? params.durations.filter((d): d is number => typeof d === 'number')
          : undefined,
        resolutions: asStringArray(params.resolutions),
        imageToVideo: asBool(params.imageToVideo),
        firstLastFrame: asBool(params.firstLastFrame),
        cameras: asStringArray(params.cameras),
      },
      defaults: {
        size: typeof defaults.size === 'string' ? defaults.size : undefined,
        aspectRatio: typeof defaults.aspectRatio === 'string' ? defaults.aspectRatio : undefined,
        quality: typeof defaults.quality === 'string' ? defaults.quality : undefined,
        durationSeconds: asPositiveInt(defaults.durationSeconds),
        resolution: typeof defaults.resolution === 'string' ? defaults.resolution : undefined,
      },
      // Form C cannot poll without an interval and a deadline; fall back to the
      // same values the built-in video entries use rather than spinning forever.
      polling:
        form === 'C'
          ? {
              intervalMs: asPositiveInt(polling.intervalMs) ?? 5000,
              timeoutMs: asPositiveInt(polling.timeoutMs) ?? 600_000,
            }
          : undefined,
    });
  });

  return { specs, errors };
};

/** Load from raw JSON, returning any problems for the settings UI to show. */
export const applyCatalogOverridesJson = (raw: string): OverrideParseResult => {
  const result = parseCatalogOverrides(raw);
  setUserMediaModelSpecs(result.specs);
  return result;
};
