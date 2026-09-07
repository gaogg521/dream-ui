/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-time recovery prompt for the 3.0.1 userData regression.
 *
 * 3.0.1 renamed the production userData directory and shipped a first-launch
 * migration that never ran (resolving `app.getPath('userData')` created the
 * target, so the migration always concluded there was nothing to migrate — see
 * `migrateAndResolveProdUserDataDir`). Everyone who launched that build got a
 * blank profile while their conversations, model providers, skills and licence
 * stayed in the legacy directory.
 *
 * The fixed migration cannot rescue them: their new profile is no longer empty,
 * and adopting the legacy directory over a profile someone may have started
 * using would be the same data loss with the operands swapped. So we ask, once,
 * and let them decide.
 *
 * Answering "yes" does not move anything here. It writes a marker and
 * relaunches; the rename happens at the top of the next boot, before Chromium
 * or dreamcore has opened a single file under either directory. Windows will
 * not rename a directory with open handles, and by the time this prompt can be
 * shown the current profile has plenty.
 */

import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  findImportableLegacyUserDataDir,
  LEGACY_USERDATA_IMPORT_DECLINED_MARKER,
  LEGACY_USERDATA_IMPORT_REQUESTED_MARKER,
} from '@/common/platform';
import { normalizeLanguageCode } from '@/common/config/i18n';
import i18n, { setInitialLanguage } from '@process/services/i18n';
import { ProcessConfig } from '@process/utils/initStorage';

/**
 * `relaunching` means the process is on its way out — the caller must return
 * immediately rather than continue booting the profile we are replacing.
 */
export type LegacyUserDataImportOutcome = 'relaunching' | 'declined' | 'nothing-to-import';

/**
 * The dialog has to be readable before the profile that holds the language
 * preference has been adopted — which is the whole point of the prompt. The
 * blank profile has no saved language, so fall back to the OS locale rather
 * than to `en-US`, which would show a Chinese user an English dialog about
 * their missing data.
 */
async function resolveDialogLanguage(): Promise<string> {
  let saved: string | undefined;
  try {
    saved = (await ProcessConfig.get('language')) ?? undefined;
  } catch {
    saved = undefined;
  }
  return saved ?? normalizeLanguageCode(app.getLocale());
}

/**
 * Ask once, and act on the answer. Call after `initializeProcess()` (the
 * language lookup needs storage) and BEFORE the backend starts, so a user who
 * accepts never gets a dreamcore booted against the profile we are about to
 * move aside.
 */
export async function maybeOfferLegacyUserDataImport(): Promise<LegacyUserDataImportOutcome> {
  // Dev and E2E run under their own directory names and never migrate.
  if (!app.isPackaged) return 'nothing-to-import';

  const legacyPath = findImportableLegacyUserDataDir(app.getPath('appData'), app.getPath('userData'));
  if (!legacyPath) return 'nothing-to-import';

  await setInitialLanguage(await resolveDialogLanguage());
  const t = i18n.t.bind(i18n);

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: t('common.backendStartup.legacyUserDataImport.title'),
    message: t('common.backendStartup.legacyUserDataImport.title'),
    detail: t('common.backendStartup.legacyUserDataImport.detail', { path: legacyPath }),
    buttons: [
      t('common.backendStartup.legacyUserDataImport.importAndRestart'),
      t('common.backendStartup.legacyUserDataImport.notNow'),
    ],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });

  const marker = response === 0 ? LEGACY_USERDATA_IMPORT_REQUESTED_MARKER : LEGACY_USERDATA_IMPORT_DECLINED_MARKER;
  try {
    fs.writeFileSync(path.join(legacyPath, marker), `${new Date().toISOString()}\n`);
  } catch (error) {
    // Without the marker neither answer can be carried out: "yes" is executed
    // by the next boot reading it, and "no" is remembered by it. Say so and
    // carry on into the current profile rather than half-acting.
    console.error('[legacy-userdata] could not record the import answer; continuing with the current profile', error);
    return 'nothing-to-import';
  }

  if (response !== 0) return 'declined';

  app.relaunch();
  app.exit(0);
  return 'relaunching';
}
