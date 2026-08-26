/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { App } from 'electron';

import { APP_USER_MODEL_ID, DEV_APP_USER_MODEL_ID } from '@/common/platform';

/**
 * Windows AppUserModelID for packaged builds.
 *
 * MUST stay in sync with the `appId` field in packages/desktop/electron-builder.yml.
 * The NSIS installer stamps that appId onto the Start Menu shortcut; Windows only
 * delivers toast notifications when the running process registers the same
 * AppUserModelID. Electron performs this registration automatically for
 * Squirrel.Windows installers only, so NSIS builds must do it themselves.
 * Consistency with electron-builder.yml is guarded by a unit test.
 *
 * ⚠️ Fork note: upstream hardcodes its own `com.dream.app` here. This fork ships
 * under a different appId and already owns the value in `@/common/platform`, so
 * this module re-exports that single source rather than keeping a second copy —
 * two literals would drift the moment either side changed, and the failure is
 * silent (toasts stop arriving, taskbar grouping splits) rather than loud.
 */
export const WINDOWS_APP_USER_MODEL_ID = APP_USER_MODEL_ID;

type AppUserModelIdTarget = Pick<App, 'isPackaged' | 'setAppUserModelId'>;

type RegisterWindowsAppUserModelIdOptions = {
  app: AppUserModelIdTarget;
  platform?: NodeJS.Platform;
  execPath?: string;
};

/**
 * Register the process-side AppUserModelID so Windows can deliver toast
 * notifications for NSIS-installed builds. No-op on non-Windows platforms.
 *
 * ⚠️ Fork note: upstream registers `process.execPath` for unpackaged builds (per
 * the Electron notifications tutorial). This fork registers an explicit
 * `.dev`-suffixed id instead, so a dev instance does not taskbar-group with a
 * real installed copy — matching what `configureChromium.ts` already does. Both
 * call sites therefore set the SAME value; whichever runs last is harmless.
 * Keep it that way: if these two ever disagree, the taskbar identity silently
 * depends on call order.
 */
export function registerWindowsAppUserModelId(options: RegisterWindowsAppUserModelIdOptions): void {
  const { app, platform = process.platform } = options;
  if (platform !== 'win32') {
    return;
  }
  app.setAppUserModelId(app.isPackaged ? WINDOWS_APP_USER_MODEL_ID : DEV_APP_USER_MODEL_ID);
}
