/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { setApplicationMainWindow } from '../bridge/applicationBridge';
import { setNotificationMainWindow } from '../bridge/notificationBridge';
import { setDeepLinkMainWindow } from './deepLink';
import { setTrayMainWindow } from './tray';

export const bindMainWindowReferences = (window: BrowserWindow): void => {
  setTrayMainWindow(window);
  setDeepLinkMainWindow(window);
  setApplicationMainWindow(window);
  setNotificationMainWindow(window);
};

export const showAndFocusMainWindow = (window: BrowserWindow): void => {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
};

export const showOrCreateMainWindow = ({
  mainWindow,
  createWindow,
}: {
  mainWindow: BrowserWindow | null | undefined;
  createWindow: () => void;
}): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showAndFocusMainWindow(mainWindow);
    return;
  }

  createWindow();
};

/**
 * Give downloads a real filename and a real destination.
 *
 * Six renderer call sites (the enterprise file vault, media results, tool
 * outputs, the preview panel, the diff viewer, the HTML exporter) all download
 * by building a blob URL and clicking an `<a download="…">`. With no
 * `will-download` handler on the session, none of that reached disk usefully:
 * the file landed in the OS download directory under a GUID with a `.tmp`
 * extension, no dialog, no notification, no error — the vault's "下载" button
 * looked like it did nothing at all.
 *
 * The handler below sets a save path explicitly, which both fixes the name and
 * keeps the flow dialog-free, and de-duplicates rather than overwriting: two
 * downloads of the same report should not silently become one file.
 */
export const attachDownloadHandler = (window: BrowserWindow): void => {
  window.webContents.session.on('will-download', (_event, item) => {
    const suggested = item.getFilename();
    const directory = app.getPath('downloads');
    const target = uniqueDownloadPath(directory, suggested);
    console.log('[download] saving', { suggested, target });
    item.setSavePath(target);
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        console.log('[download] completed', { target });
        return;
      }
      // Interrupted or cancelled: say so rather than leaving the user to
      // discover the absence later.
      console.warn('[download] did not complete', { target, state });
    });
  });
};

/**
 * `report.pdf` → `report.pdf`, then `report (1).pdf`, `report (2).pdf`, …
 *
 * Deliberately not an overwrite: the previous download is somebody's file, and
 * a silent replacement is not recoverable.
 */
const uniqueDownloadPath = (directory: string, fileName: string): string => {
  const safeName = fileName.trim() || 'download';
  const extension = path.extname(safeName);
  const stem = path.basename(safeName, extension);
  let candidate = path.join(directory, safeName);
  for (let n = 1; fs.existsSync(candidate); n += 1) {
    candidate = path.join(directory, `${stem} (${n})${extension}`);
  }
  return candidate;
};
