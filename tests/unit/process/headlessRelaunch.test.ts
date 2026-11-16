/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHeadlessRelaunchArgs, needsHeadlessRelaunch } from '@process/utils/headlessRelaunch';

const EXE = '/opt/One Work/onework';

describe('needsHeadlessRelaunch', () => {
  it('relaunches a bare Linux --webui (the case that died with "Missing X server")', () => {
    expect(needsHeadlessRelaunch('linux', [EXE, '--webui'])).toBe(true);
  });

  it('also covers --resetpass, which never needs a display either', () => {
    expect(needsHeadlessRelaunch('linux', [EXE, '--resetpass', 'admin'])).toBe(true);
  });

  it('does not loop: a command line that already names an Ozone platform is left alone', () => {
    expect(needsHeadlessRelaunch('linux', [EXE, '--webui', '--ozone-platform=headless', '--disable-gpu'])).toBe(false);
    expect(needsHeadlessRelaunch('linux', [EXE, '--webui', '--ozone-platform', 'x11'])).toBe(false);
  });

  it('never touches the desktop launch or other platforms', () => {
    expect(needsHeadlessRelaunch('linux', [EXE])).toBe(false);
    expect(needsHeadlessRelaunch('win32', ['C:\\onework.exe', '--webui'])).toBe(false);
    expect(needsHeadlessRelaunch('darwin', ['/Applications/One Work', '--webui'])).toBe(false);
  });
});

describe('buildHeadlessRelaunchArgs', () => {
  it('drops the executable, keeps user args in order, appends the headless flags', () => {
    expect(buildHeadlessRelaunchArgs([EXE, '--webui', '--port', '8080'])).toEqual([
      '--webui',
      '--port',
      '8080',
      '--ozone-platform=headless',
      '--disable-gpu',
    ]);
  });

  it('does not duplicate --disable-gpu when the user already passed it', () => {
    expect(buildHeadlessRelaunchArgs([EXE, '--webui', '--disable-gpu'])).toEqual([
      '--webui',
      '--disable-gpu',
      '--ozone-platform=headless',
    ]);
  });

  it('produces args that the relaunched process will not relaunch again', () => {
    const args = buildHeadlessRelaunchArgs([EXE, '--webui']);
    expect(needsHeadlessRelaunch('linux', [EXE, ...args])).toBe(false);
  });
});

describe('configureChromium wiring', () => {
  // The helper is only useful if it runs before anything touches userData, and the
  // old in-process appendSwitch (too late to matter) must not be mistaken for the fix.
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../packages/desktop/src/process/utils/configureChromium.ts'),
    'utf8'
  );

  it('relaunches before configureAppDataProfile runs', () => {
    const relaunchAt = source.indexOf('app.relaunch(');
    const profileAt = source.indexOf('configureAppDataProfile(app)');
    expect(relaunchAt).toBeGreaterThan(-1);
    expect(profileAt).toBeGreaterThan(relaunchAt);
  });

  it('exits the throwaway process right after scheduling the relaunch', () => {
    expect(source).toMatch(/app\.relaunch\(.*\);\s*app\.exit\(0\);/);
  });
});
