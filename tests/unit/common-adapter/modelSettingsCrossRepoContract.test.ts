/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * `ModelSettings` is a cross-repo contract with no enforcement on either side.
 *
 * The settings page writes it, `PUT /api/providers/:id` carries it, and
 * dream-core's `ModelSettings` struct deserializes it. That struct is not
 * `deny_unknown_fields` — so a key the Rust side has no field for is not an
 * error, it is *dropped*, silently, and handed back without it on the next
 * read. Nothing logs. The client's PUT succeeds. The user picks a value, saves,
 * reopens the dialog, and finds the control back at its default.
 *
 * It has happened three times:
 *   - `model_kind` and the media declarations (fixed when someone noticed);
 *   - `media_unit_prices_usd`, from the day per-resolution pricing shipped —
 *     every tier price a user typed was discarded, and both the cost display
 *     and the usage ledger silently fell back to the flat rate;
 *   - `max_tokens_field`, one release later, which is what prompted this test.
 *
 * So: every field the TS type declares must exist on the Rust struct. The
 * reverse is fine — the backend may carry a field the client does not write
 * yet.
 *
 * Skips when dream-core is not checked out beside this repo. That is the
 * layout CLAUDE.md recommends for development, so this fires for anyone
 * working on the pair; it cannot fire in dream-ui's own CI, which clones one
 * repo. A guard that only catches this on a developer machine still catches it
 * before the release that would ship it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../../..');
const rustProvider = resolve(projectRoot, '../dream-core/crates/dream-core-api-types/src/provider.rs');

/** Field names of a `pub struct <name> { … }` block. */
function rustStructFields(source: string, name: string): string[] {
  const start = source.indexOf(`pub struct ${name} {`);
  if (start === -1) return [];
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^\s*pub\s+([a-z0-9_]+)\s*:/gm)].map((m) => m[1]);
}

/** Property names of an `export type <name> = { … }` block. */
function tsTypeFields(source: string, name: string): string[] {
  const start = source.indexOf(`export type ${name} = {`);
  if (start === -1) return [];
  const body = source.slice(start, source.indexOf('\n};', start));
  return [...body.matchAll(/^\s{2}([a-z0-9_]+)\??\s*:/gim)].map((m) => m[1]);
}

describe('model_settings_carries_every_field_the_client_sends', () => {
  const available = existsSync(rustProvider);
  const itWithCore = available ? it : it.skip;

  itWithCore('has a Rust field for every key the settings page writes', () => {
    const ts = tsTypeFields(
      readFileSync(resolve(projectRoot, 'packages/desktop/src/common/config/storage.ts'), 'utf8'),
      'ModelSettings'
    );
    const rust = rustStructFields(readFileSync(rustProvider, 'utf8'), 'ModelSettings');

    // Guards the guard: a parser that silently found nothing would pass every
    // time and protect nothing.
    expect(ts.length).toBeGreaterThan(4);
    expect(rust.length).toBeGreaterThan(4);
    expect(ts).toContain('model_kind');
    expect(rust).toContain('model_kind');

    expect(ts.filter((field) => !rust.includes(field))).toEqual([]);
  });
});
