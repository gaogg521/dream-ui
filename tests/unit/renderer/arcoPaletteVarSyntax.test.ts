/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * Arco stores its palette as comma-separated channels — `--primary-6` is
 * "22,93,255", not "22 93 255". UnoCSS compiles an arbitrary color like
 * `text-[rgb(var(--primary-6))]` down to
 * `color: rgb(var(--primary-6) / var(--un-text-opacity))`, and that
 * space-separated `rgb(… / …)` form cannot parse a comma-separated value, so
 * the browser drops the whole declaration. The class is present, the
 * generated CSS looks right, and the element silently renders in the
 * inherited color — 41 occurrences across 17 files were dead this way.
 *
 * `rgba(var(--x), 1)` compiles to the legacy comma form and works. Plain CSS
 * and inline styles (`color: 'rgb(var(--primary-6))'`) are fine and not
 * covered here: without UnoCSS appending an alpha they are valid legacy
 * syntax.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../../../packages/desktop/src');

/** The UnoCSS bracket form only — `[rgb(var(--x))]`. */
const BRACKETED_RGB_VAR = /\[rgb\(var\(--[a-z0-9-]+\)\)\]/g;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('UnoCSS arbitrary colors built on Arco palette vars', () => {
  it('flags the form that silently renders unstyled', () => {
    const sample = `className='text-[rgb(var(--primary-6))]'`;
    expect(sample.match(BRACKETED_RGB_VAR)).toHaveLength(1);
  });

  it('accepts the rgba form, and leaves plain CSS values alone', () => {
    const sample = [
      `className='text-[rgba(var(--primary-6),1)] bg-[rgba(var(--warning-6),0.1)]'`,
      `style={{ color: 'rgb(var(--primary-6))' }}`,
    ].join('\n');
    expect(sample.match(BRACKETED_RGB_VAR)).toBeNull();
  });

  it('holds across the desktop sources', () => {
    const offenders = listSourceFiles(SRC_ROOT).flatMap((file) => {
      const hits = fs.readFileSync(file, 'utf8').match(BRACKETED_RGB_VAR) ?? [];
      return hits.map((hit) => `${path.relative(SRC_ROOT, file).split(path.sep).join('/')}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });
});
