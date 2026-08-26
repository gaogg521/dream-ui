/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_DISPLAY_NAME } from '@/common/platform';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

/**
 * Brand surfaces that nothing else validates.
 *
 * The i18n checker only covers `locales/`, tsc has no opinion about copy, and no
 * feature test reads a tray tooltip. So a stale product name here ships silently
 * and is found by a user hovering their taskbar — which is exactly how the
 * tooltip stayed "Dream UI" across several rebrands.
 *
 * These assertions are cheap and they fail loudly the next time the product is
 * renamed without sweeping every surface.
 */
describe('brand surfaces outside i18n', () => {
  it('keeps BRAND_DISPLAY_NAME equal to the packaged productName', () => {
    const yml = read('packages/desktop/electron-builder.yml');
    const productName = yml.match(/^productName:\s*(.+)$/m)?.[1]?.trim();

    expect(productName).toBeTruthy();
    expect(BRAND_DISPLAY_NAME).toBe(productName);
  });

  it('sets the tray tooltip from the shared constant, never a literal', () => {
    const tray = read('packages/desktop/src/process/utils/tray.ts');

    expect(tray).toContain('tray.setToolTip(BRAND_DISPLAY_NAME)');
    // A literal here is the actual failure mode — it looks right at review time
    // and rots the moment the product is renamed.
    expect(tray).not.toMatch(/setToolTip\(\s*['"`]/);
  });

  it('leaves no upstream product name in user-visible main-process strings', () => {
    // Scoped to the surfaces users read. Internal identifiers (AIONUI_*,
    // aionui-*) and package/URL references are deliberately out of scope — see
    // the brand boundary rule. Log prefixes used to be excluded too; they have
    // since been swept to "[1ONE] ...", so the guard now covers them and a
    // reintroduced "[AionUi]" prefix fails here.
    const files = [
      'packages/desktop/src/process/utils/tray.ts',
      'packages/desktop/src/process/startup/architectureCompatibility.ts',
    ];

    for (const file of files) {
      // Strip comments first: this rule is about strings that reach a screen, and
      // the comments explaining the rule naturally quote the old name.
      const source = read(file)
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n');

      const offenders = [...source.matchAll(/(['"`])([^'"`\n]*AionUi[^'"`\n]*)\1/g)]
        .map((match) => match[2])
        .filter((text) => !/^aionui[-_]/i.test(text) && !text.includes('aionui.com'));

      expect(offenders, `${file} carries a user-visible upstream brand string`).toEqual([]);
    }
  });
});
