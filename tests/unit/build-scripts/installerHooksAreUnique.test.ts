/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * NSIS cannot be unit-tested here, and both failures this pins only appear on a
 * machine that already has an older build installed — the machine nobody tests
 * on.
 *
 * The expensive one was a duplicate hook macro. electron-builder compiles
 * `buildResources/installer.nsh` AND whatever `--config.nsis.include` names.
 * Defining `preInit` or `customInstall` in both does not merge them and does
 * not fail the build: one definition wins and the other is silently dead. A
 * `customInstall` added to the wrong file compiled, signed, shipped, installed
 * cleanly, and never executed a line. Only the installer's own session log
 * showed it — ending `detail=customInstall` from a macro in a different file.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '../../..');
const WINDOWS_NSH_DIR = join(REPO, 'resources/windows');
const BUILD_RESOURCE_NSH = join(REPO, 'packages/desktop/resources/installer.nsh');
const VERIFY_NSH = join(WINDOWS_NSH_DIR, 'installer-update-verify.nsh');

/** electron-builder's NSIS hook macros — the ones that must be unique. */
const HOOKS = [
  'preInit',
  'customInit',
  'customInstall',
  'customHeader',
  'customUnInstall',
  'customUnInstallCheck',
  'customUnInstallCheckCurrentUser',
];

/**
 * The two architecture entry files are mutually exclusive — build-with-builder
 * passes exactly one through `--config.nsis.include` — so the same hook
 * appearing in both is by design, not a collision.
 */
const ARCH_ENTRIES = ['windows-installer-x64.nsh', 'windows-installer-arm64.nsh'];

function scriptsCompiledTogether(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (existsSync(BUILD_RESOURCE_NSH)) {
    out.push(['packages/desktop/resources/installer.nsh', readFileSync(BUILD_RESOURCE_NSH, 'utf8')]);
  }
  for (const name of readdirSync(WINDOWS_NSH_DIR)) {
    if (!name.endsWith('.nsh')) continue;
    if (ARCH_ENTRIES.includes(name)) continue;
    out.push([`resources/windows/${name}`, readFileSync(join(WINDOWS_NSH_DIR, name), 'utf8')]);
  }
  // Exactly one arch entry is ever compiled; x64 stands in for the pair.
  out.push([`resources/windows/${ARCH_ENTRIES[0]}`, readFileSync(join(WINDOWS_NSH_DIR, ARCH_ENTRIES[0]), 'utf8')]);
  return out;
}

describe('Windows installer hook macros', () => {
  it('are each defined exactly once across the scripts compiled together', () => {
    const scripts = scriptsCompiledTogether();
    const offenders = HOOKS.map((hook) => {
      const definedIn = scripts
        .filter(([, body]) => new RegExp(`^!macro\\s+${hook}\\b`, 'm').test(body))
        .map(([label]) => label);
      return definedIn.length > 1 ? `${hook}: ${definedIn.join(' + ')}` : null;
    }).filter(Boolean);

    expect(offenders, 'a second definition of a hook is not an error — it is a macro that never runs').toEqual([]);
  });

  it('keeps the arch entries as the only place preInit is defined', () => {
    // The pin that used to live in buildResources/installer.nsh was both a
    // duplicate and unnecessary: `executableName: onework` already makes
    // Programs\onework the default, via multiUser.nsh's $0\${APP_FILENAME}.
    expect(existsSync(BUILD_RESOURCE_NSH), 'buildResources/installer.nsh reintroduces a duplicate preInit').toBe(false);
  });
});

describe('the orphaned-install sweep', () => {
  const verify = readFileSync(VERIFY_NSH, 'utf8');
  const lines = verify.split('\n');
  const at = (needle: string) => lines.findIndex((l) => l.includes(needle) && !l.trim().startsWith(';'));

  it('runs from the customInstall that actually executes', () => {
    expect(verify).toContain('!macro DREAM_REMOVE_ORPHANED_INSTALLS');
    expect(at('!insertmacro DREAM_REMOVE_ORPHANED_INSTALLS')).toBeGreaterThan(at('!macro customInstall'));
  });

  it('guards the removal on all three conditions', () => {
    const notInstdir = at('StrCmp $R7 "$INSTDIR"');
    const hasAsar = at('IfFileExists "$R7\\resources\\app.asar"');
    const remove = at('RMDir /r "$R7"');

    expect(notInstdir, 'never delete the directory this install just wrote to').toBeGreaterThan(-1);
    expect(hasAsar, 'app.asar is what makes RMDir /r defensible').toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(-1);
    expect(notInstdir).toBeLessThan(remove);
    expect(hasAsar).toBeLessThan(remove);
  });

  /**
   * This test used to assert the OPPOSITE — that 1onecode must be spared
   * "because it still has a working uninstall entry under an older appId".
   * That premise was simply false: `appId: com.huanle.oneone.ai` has never
   * changed since the first commit, and the 1oneUI snapshot the 1onecode
   * build came from declares the same one. Neither sets `guid`, so all three
   * installs derive the same uninstall key and the last one to run owns it.
   * 1onecode's entry was overwritten years of releases ago; nothing owns it,
   * which is exactly the condition that qualifies it for the sweep.
   *
   * The rule is "nothing else can clean this up", not "ours and large" — and
   * on the evidence 1onecode now meets it just as "One Work" does.
   */
  it('sweeps every install directory older builds wrote to', () => {
    const body = verify.slice(verify.indexOf('!macro DREAM_REMOVE_ORPHANED_INSTALLS'));
    const macro = body.slice(0, body.indexOf('!macroend'));
    expect(macro).toContain('Programs\\One Work');
    expect(macro).toContain('Programs\\1onecode');
  });

  /**
   * The sweep must not grow a second copy of the stale-registry rule.
   * AIONUI_HEAL_INSTALL_REGISTRY already clears an entry whose
   * InstallLocation has no onework.exe, and two rules for one fact is the
   * failure this whole file exists to pin.
   */
  it('leaves the registry to the one macro that owns it', () => {
    const body = verify.slice(verify.indexOf('!macro DREAM_REMOVE_ORPHANED_INSTALL_AT'));
    const macro = body.slice(0, body.indexOf('!macroend'));
    expect(macro).not.toMatch(/DeleteRegKey|WriteRegStr/);
  });

  /** Removing a program directory must never reach the user's data. */
  it('never names the userData directory', () => {
    expect(verify).not.toContain('APPDATA\\One Work');
    expect(verify).not.toMatch(/RMDir[^\n]*APPDATA/);
  });
});
