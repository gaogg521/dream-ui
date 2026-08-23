/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, type BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';

/**
 * Dev and packaged builds each claim this OS-level URL protocol at every
 * launch (see index.ts's `setAsDefaultProtocolClient` call). Since the
 * registration is a single global Windows/macOS association, whichever
 * build launched most recently silently steals it from the other — a dev
 * session started after installing the packaged app leaves `dream://`
 * pointed at the dev Electron binary, so SSO deep links from a
 * subsequently-tested packaged build never reach it (login succeeds in the
 * browser, but the desktop app never sees the callback). Using a distinct
 * scheme per build mode keeps the two from fighting over the same key.
 * The backend mirrors this via the `scheme` query param on
 * `/api/one/sso/{provider}/authorize` (see one-sso's `sanitize_deep_link_scheme`).
 */
export const PROTOCOL_SCHEME = app.isPackaged ? 'aionui' : 'aionui-dev';

/**
 * Parse an dream:// URL into action and params.
 * Supports two formats:
 *   1. dream://add-provider?base_url=xxx&api_key=xxx
 *   2. dream://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 */
export const parseDeepLinkUrl = (url: string): { action: string; params: Record<string, string> } | null => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          Object.assign(params, json);
        }
      } catch {
        // Ignore decode errors
      }
      delete params.data;
    }

    return { action, params };
  } catch {
    return null;
  }
};

let mainWindowRef: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`)) || null;

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getPendingDeepLinkUrl = (): string | null => pendingDeepLinkUrl;

export const clearPendingDeepLinkUrl = (): void => {
  pendingDeepLinkUrl = null;
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
export const handleDeepLinkUrl = (url: string): void => {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    pendingDeepLinkUrl = url;
    return;
  }

  ipcBridge.deepLink.received.emit(parsed);
};
