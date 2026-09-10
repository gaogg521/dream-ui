/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * NSIS cannot be unit-tested here, and the failure it produces is only visible
 * on a machine that already has an older build installed — which is exactly the
 * machine nobody tests on. So this pins the reasoning in the script instead.
 *
 * The bug it guards against shipped: `InstallLocation` under the app's uninstall
 * key is one value doing two jobs. `multiUser.nsh` reads it to seed `$INSTDIR`
 * (where the NEW version goes) and `installUtil.nsh` reads it to find the OLD
 * one, which it then runs with `_?=$installationDir`. Overwriting it in
 * `preInit` — the only lever that reaches `$INSTDIR` — pointed the old
 * uninstaller at the new directory and left the real previous install untouched,
 * so `One Work.exe` and `onework.exe` ended up installed side by side.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NSH = readFileSync(join(__dirname, '../../../packages/desktop/resources/installer.nsh'), 'utf8');

/** Index of the first line matching `needle`, or -1. */
function lineOf(needle: string): number {
  return NSH.split('\n').findIndex((l) => l.includes(needle));
}

describe('installer.nsh takes over a stale install rather than sitting beside it', () => {
  it('reads the previous InstallLocation before overwriting it', () => {
    const read = lineOf('ReadRegStr $R7 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation');
    const write = lineOf('WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation');

    expect(read, 'preInit must read the previous InstallLocation').toBeGreaterThan(-1);
    expect(write, 'preInit still pins the new default install directory').toBeGreaterThan(-1);
    // The whole bug in one assertion: the write destroys the only record of
    // where the previous install is, so the read has to come first.
    expect(read).toBeLessThan(write);
  });

  it('remembers the previous location somewhere the write cannot clobber', () => {
    expect(NSH).toContain('DreamStaleInstallLocation');
    // Stashed in preInit, consumed in customInstall — after the new version's
    // files are in place, so $INSTDIR is real by then.
    expect(lineOf('!macro preInit')).toBeLessThan(lineOf('!macro customInstall'));
  });

  it('never removes the directory it just installed into', () => {
    expect(NSH).toContain('StrCmp $R7 "$INSTDIR"');
  });

  it('only removes a directory that is demonstrably one of our installs', () => {
    const guard = lineOf('IfFileExists "$R7\\resources\\app.asar"');
    const remove = lineOf('RMDir /r "$R7"');

    expect(guard, 'the app.asar check is what makes RMDir /r defensible').toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(remove);
  });

  it('leaves the install directory converging on onework', () => {
    // The other half of the script's job, and the reason the overwrite exists
    // at all. Losing this would scatter installs across the old names again.
    expect(NSH).toContain('$LOCALAPPDATA\\Programs\\onework');
  });
});
