/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static balance check for the Windows installer sources.
 *
 * The NSIS installer is only ever compiled on a Windows build runner, so a typo in
 * a macro or define name reaches nobody until a release build fails — or worse,
 * until the installer runs. This check is the cheap half of that safety net, and it
 * runs everywhere: every `!insertmacro` must resolve to a `!macro`, and every
 * `${DEFINE}` must resolve to a `!define` (or be one of the values electron-builder
 * and our own build script inject at compile time).
 *
 * It exists because a brand rename touched 590 identifiers across these files at
 * once. Renaming them safely needed exactly this invariant; keeping it means the
 * next such change is equally cheap.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const INSTALLER_DIR = path.resolve(__dirname, '../../../resources/windows');

/**
 * Defines that exist at compile time without a `!define` in our sources:
 * electron-builder substitutes the first group, and `build-with-builder.js`
 * generates the Sentry one into a gitignored include.
 */
const EXTERNALLY_PROVIDED_DEFINES = new Set([
  'APP_EXECUTABLE_FILENAME',
  'INSTALL_REGISTRY_KEY',
  'PROJECT_DIR',
  'UNINSTALLER_OUT_FILE',
  'UNINSTALL_FILENAME',
  'UNINSTALL_REGISTRY_KEY',
  'ONEWORK_SENTRY_DSN',
]);

const NSIS_BUILTIN_DEFINES = new Set(['__FILE__', '__LINE__', '__DATE__', '__TIME__', 'NSIS_VERSION']);

const listNshFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listNshFiles(full));
    else if (full.endsWith('.nsh')) out.push(full);
  }
  return out;
};

const collect = (pattern: RegExp, source: string): Set<string> => {
  const found = new Set<string>();
  for (const match of source.matchAll(pattern)) found.add(match[1]);
  return found;
};

describe('windows installer sources', () => {
  const files = listNshFiles(INSTALLER_DIR);
  const source = files.map((f) => readFileSync(f, 'utf8')).join('\n');

  it('has installer sources to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('resolves every !insertmacro to a !macro', () => {
    const defined = collect(/^\s*!macro\s+([A-Za-z_][A-Za-z0-9_]*)/gm, source);
    const used = collect(/!insertmacro\s+([A-Za-z_][A-Za-z0-9_]*)/g, source);
    const unresolved = [...used].filter((name) => !defined.has(name)).sort();
    expect(unresolved, `!insertmacro with no matching !macro: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('resolves every ${DEFINE} to a !define or a build-time value', () => {
    const defined = collect(/^\s*!define\s+([A-Za-z_][A-Za-z0-9_]*)/gm, source);
    // Only our own naming shape (SCREAMING_SNAKE with an underscore); anything else
    // in ${...} is an NSIS variable, a LangString or a plugin token.
    const used = [...collect(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, source)].filter(
      (name) => /^[A-Z][A-Z0-9_]*$/.test(name) && name.includes('_')
    );
    const unresolved = used
      .filter((name) => !defined.has(name) && !EXTERNALLY_PROVIDED_DEFINES.has(name) && !NSIS_BUILTIN_DEFINES.has(name))
      .sort();
    expect(unresolved, `\${DEFINE} with no !define: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('keeps the inline Restart Manager namespace in step with its callers', () => {
    // The C# type is Add-Type'd from a base64 blob, so a rename of the namespace is
    // invisible to grep and to every other check here. An earlier rebrand renamed
    // the sibling query-lockers.ps1 and missed this one for exactly that reason.
    const processControl = readFileSync(path.join(INSTALLER_DIR, 'installer-process-control.nsh'), 'utf8');
    const blob = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(processControl);
    expect(blob, 'the inline Add-Type blob should still be there').not.toBeNull();

    const decoded = Buffer.from(blob![1], 'base64').toString('utf8');
    const namespace = /namespace\s+([A-Za-z.]+)/.exec(decoded);
    expect(namespace, 'the blob should declare a namespace').not.toBeNull();

    // Every `[<namespace>.Native]` style reference must name the same namespace.
    const callers = [...processControl.matchAll(/\[([A-Za-z.]+)\.Native\]/g)].map((m) => m[1]);
    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) expect(caller).toBe(namespace![1]);
  });
});
