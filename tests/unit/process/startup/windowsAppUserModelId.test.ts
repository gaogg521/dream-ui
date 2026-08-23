/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { registerWindowsAppUserModelId, WINDOWS_APP_USER_MODEL_ID } from '@/process/startup/windowsAppUserModelId';
import { DEV_APP_USER_MODEL_ID } from '@/common/platform';

const makeApp = (isPackaged: boolean) => ({
  isPackaged,
  setAppUserModelId: vi.fn(),
});

describe('registerWindowsAppUserModelId', () => {
  it('registers the electron-builder appId on packaged win32 builds', () => {
    const app = makeApp(true);
    registerWindowsAppUserModelId({ app, platform: 'win32', execPath: 'C:\\app\\AionUi.exe' });
    expect(app.setAppUserModelId).toHaveBeenCalledTimes(1);
    expect(app.setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID);
  });

  // ⚠️ Fork contract, diverging from upstream's "registers process.execPath".
  //
  // Upstream follows the Electron tutorial and registers `process.execPath` for
  // unpackaged builds. This fork registers an explicit `.dev`-suffixed id so a
  // dev instance never taskbar-groups with a real installed copy — the same
  // value `configureChromium.ts` already sets, which matters because BOTH run
  // and the last one wins. If this test is ever "fixed" back to execPath, the
  // two call sites disagree and the taskbar identity silently depends on order.
  it('registers the dev-suffixed id on win32 development builds', () => {
    const app = makeApp(false);
    registerWindowsAppUserModelId({ app, platform: 'win32', execPath: 'C:\\dev\\electron.exe' });
    expect(app.setAppUserModelId).toHaveBeenCalledTimes(1);
    expect(app.setAppUserModelId).toHaveBeenCalledWith(DEV_APP_USER_MODEL_ID);
  });

  it('does not register on non-win32 platforms', () => {
    const app = makeApp(true);
    registerWindowsAppUserModelId({ app, platform: 'darwin', execPath: '/usr/local/bin/electron' });
    expect(app.setAppUserModelId).not.toHaveBeenCalled();
  });

  it('stays in sync with the appId in electron-builder.yml', () => {
    const ymlPath = path.resolve(__dirname, '../../../../packages/desktop/electron-builder.yml');
    const yml = fs.readFileSync(ymlPath, 'utf8');
    const match = yml.match(/^appId:\s*(\S+)\s*$/m);
    expect(match?.[1]).toBe(WINDOWS_APP_USER_MODEL_ID);
  });
});
