/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Path aliases (`@/`, `@common/`, `@process/`, `@renderer/`, `@worker/`) are a
 * build-time concept. Rollup rewrites them in static `import` statements and
 * leaves them untouched inside a runtime `require()`, so an aliased require
 * resolves in dev (where the alias is live) and throws in the packaged app.
 *
 * These call sites are typically written as a lazy require wrapped in a
 * try/catch fallback, which turns the throw into permanent silence. That is not
 * hypothetical: `mediaJob`'s `fallbackWorkspaceDir` shipped this way, so every
 * media job in every packaged build quietly used `process.cwd()` — exactly the
 * behaviour the helper was added to replace.
 *
 * `scripts/build-with-builder.js` makes the same check against the built main
 * bundle. This one runs against source, so the mistake is caught before a build
 * is ever produced.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const projectRoot = resolve(__dirname, '../../..');
const sourceRoot = resolve(projectRoot, 'packages/desktop/src');

/** Matches `require('<alias>/…')` for the aliases declared in electron.vite.config.ts. */
const ALIASED_REQUIRE = /require\(\s*['"](@\/|@common\/|@process\/|@renderer\/|@worker\/)[^'"]*['"]\s*\)/g;

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Blank out comments before scanning, keeping every character position so the
 * reported line numbers still point at real code. Without this the check fires
 * on prose that merely quotes the anti-pattern - including the comment in
 * mediaJob explaining why the require was removed - and the first person to hit
 * that false positive deletes the check.
 */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix: string) => prefix + ' '.repeat(match.length - prefix.length));
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(target, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    out.push(target);
  }
  return out;
}

describe('runtime requires of path aliases', () => {
  it('does not appear anywhere under packages/desktop/src', () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(sourceRoot)) {
      const source = blankComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(ALIASED_REQUIRE)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${relative(projectRoot, file)}:${line} ${match[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('matches an aliased require but not a scoped npm package', () => {
    // Guards the guard: a regex that also flagged `@anthropic-ai/sdk` would be
    // turned off by the next person who hit the false positive.
    const aliased = `const { getSystemDir } = require('@process/utils/initStorage');`;
    const scopedPackage = `const sdk = require('@anthropic-ai/sdk');`;

    expect([...aliased.matchAll(ALIASED_REQUIRE)]).toHaveLength(1);
    expect([...scopedPackage.matchAll(ALIASED_REQUIRE)]).toHaveLength(0);
  });
});
