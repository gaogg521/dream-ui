/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ratchet: keep pre-rebrand brand names out of the product runtime.
 *
 * This repo was copied from an upstream project and renamed. Two sweeps have
 * already run, and both times the leftovers were found the same way — a plain
 * literal sitting somewhere that does not look like brand-bearing code (a layout
 * component's localStorage key, a cron page hook, a CSS class). Grepping is the
 * cheap check; this test is that grep, run in CI so it cannot be forgotten.
 *
 * WHAT IS ALLOWED. Some occurrences are load-bearing and must NOT be "cleaned":
 * a renamed key still has to READ the old name or the user silently loses what
 * they had, and a cross-process contract has to keep accepting the old value
 * until both sides have shipped. The convention that marks those is the word
 * `legacy` (any case) on the same line or in the preceding lines of the same
 * block — plus the explicit file allowlist below for whole files whose subject
 * IS the migration.
 *
 * So: if this test fails, the fix is usually NOT to add an allowlist entry. It
 * is to rename the thing, and — when the value is persisted or crosses a process
 * boundary — to add the compat read next to it and say `legacy` in the comment.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');

/** The shipped runtime. */
const SCAN_ROOTS = [
  'packages/desktop/src',
  'packages/web-host/src',
  'packages/web-cli/src',
  'packages/shared-scripts/src',
];

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html', '.json']);

/**
 * Everything that builds, packages, installs or smoke-tests the product. It does
 * not ship, but it is where the stale names did the most damage: a release check
 * looking for the old artifact prefix, a web-CLI smoke test asserting the old
 * bundled-backend directory, and an installer that never registered the real
 * backend binary with the Restart Manager. All three were green and wrong.
 */
const BUILD_SCAN_ROOTS = ['scripts', 'resources/windows'];

const BUILD_SCAN_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.sh', '.ps1', '.nsh', '.yml']);

/**
 * Files in the build surface whose whole subject is the migration, or that are
 * one-off tooling pointed at the read-only pre-fork archive. Listed with a reason
 * so the list cannot quietly become a dumping ground.
 */
const ALLOWED_BUILD_FILES = new Map([
  ['scripts/fix_doc_names.py', 'one-off copyright-filing tooling that runs against the archive checkout'],
  ['scripts/fix_quotes.py', 'same'],
  ['scripts/fix_quotes2.py', 'same'],
  ['scripts/gen_doc_docx.py', 'same'],
  ['scripts/gen_source_docx.py', 'same'],
  ['scripts/gen_source_pdf.py', 'same'],
]);

const BRAND_PATTERN = /aionui|aioncore|aionrs|aion[_-]hub|AION_FILES/i;

/**
 * Whole files whose subject is the rebrand migration itself. Every name here is
 * a compat layer or a historical record — not residue.
 */
const ALLOWED_FILES = new Set([
  // Maps current localStorage keys to the pre-rebrand ones and copies them forward.
  'packages/desktop/src/renderer/utils/storage/legacyStorageKeys.ts',
  // Historical SQLite migrations. These describe what was ALREADY applied on real
  // installs; editing one rewrites history and breaks the applied-version check.
  'packages/desktop/src/process/services/database/migrations.ts',
  'packages/desktop/src/process/services/database/runLegacyDatabaseMigrations.ts',
  // Imports a pre-rebrand database.
  'packages/desktop/src/process/services/oneMigration/importOneLegacyDb.ts',
  // Anti-FOUC inline script: reads both theme keys before any module loads, so it
  // cannot go through legacyStorageKeys.
  'packages/desktop/src/renderer/index.html',
  // The hub manifest is downloaded from the upstream project; its field names are
  // an external contract we do not own.
  'packages/desktop/src/common/types/agent/hub.ts',
]);

const listFiles = (dir: string, extensions: Set<string> = SCAN_EXTENSIONS): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // Build output, not source. `resources/bundled-*` is gitignored and holds a
    // downloaded backend whose own file names we do not control.
    if (entry === 'node_modules' || entry.startsWith('bundled-')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, extensions));
    } else if (extensions.has(path.extname(entry))) {
      out.push(full);
    }
  }
  return out;
};

/**
 * A hit is accepted when the surrounding code says it is deliberate. One of the
 * markers has to appear on the line itself or in the few lines above it, which is
 * where the explaining comment or the `LEGACY_*` binding sits. All three spellings
 * are already in use here; the guard follows the code rather than forcing the
 * prose to match one regex.
 */
const DELIBERATE_MARKERS = ['legacy', 'pre-rebrand', 'pre-fork'];

const isMarkedLegacy = (lines: string[], index: number): boolean => {
  // Both directions on purpose. A multi-line comment explains the old name first
  // and the `LEGACY_*` binding it belongs to comes after it, so looking only
  // upwards flags the explanation itself.
  const window = lines
    .slice(Math.max(0, index - 12), index + 13)
    .join('\n')
    .toLowerCase();
  return DELIBERATE_MARKERS.some((marker) => window.includes(marker));
};

describe('brand residue', () => {
  it('has no unmarked pre-rebrand brand names in the product runtime', () => {
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      const abs = path.join(REPO_ROOT, root);
      let files: string[];
      try {
        files = listFiles(abs);
      } catch {
        continue; // a package that does not exist in this checkout
      }

      for (const file of files) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        if (ALLOWED_FILES.has(rel)) continue;

        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!BRAND_PATTERN.test(line)) return;
          if (isMarkedLegacy(lines, i)) return;
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
        });
      }
    }

    expect(
      offenders,
      `Pre-rebrand brand names found in the product runtime.\n\n` +
        `Rename them. If the value is persisted or crosses a process boundary, keep a\n` +
        `read of the old name beside it and use the word "legacy" in that comment — do\n` +
        `not just add the file to ALLOWED_FILES.\n\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('has no unmarked pre-rebrand brand names in the build and installer scripts', () => {
    const offenders: string[] = [];

    for (const root of BUILD_SCAN_ROOTS) {
      const abs = path.join(REPO_ROOT, root);
      let files: string[];
      try {
        files = listFiles(abs, BUILD_SCAN_EXTENSIONS);
      } catch {
        continue;
      }

      for (const file of files) {
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        if (ALLOWED_BUILD_FILES.has(rel)) continue;

        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!BRAND_PATTERN.test(line)) return;
          if (isMarkedLegacy(lines, i)) return;
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
        });
      }
    }

    expect(
      offenders,
      `Pre-rebrand brand names found in the build/installer surface.\n\n` +
        `These do not ship, but they decide what gets built, packaged and verified —\n` +
        `a stale name here is a check that passes while looking at the wrong thing.\n\n` +
        `${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('keeps every build-surface allowance explained', () => {
    for (const [file, reason] of ALLOWED_BUILD_FILES) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(3);
    }
  });
});
