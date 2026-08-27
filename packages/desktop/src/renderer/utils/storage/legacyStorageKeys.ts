/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Carry pre-rebrand localStorage entries over to their current key names.
 *
 * These keys hold UI preferences the user set by hand — theme, language,
 * sidebar and workspace-tree collapse state, recent workspaces, recently used
 * emoji. Renaming the key without moving the value silently resets all of it on
 * upgrade: nothing errors, the reader just finds nothing and falls back to a
 * default, and the user is left re-doing settings they had already chosen.
 *
 * Copies rather than moves. The legacy entry is left in place so a downgrade
 * still finds its data, and a few hundred bytes of stale localStorage costs
 * nothing next to a user losing their setup because they rolled back.
 *
 * Runs once at renderer start, before anything reads these keys, so every call
 * site can just use the current name. The one key this cannot cover is
 * `__one_theme`: `index.html` reads it in an inline script before any module
 * loads (anti-FOUC), so that one reads both names there directly.
 */

/** Current key → the pre-rebrand key it replaced. */
export const LEGACY_LOCAL_STORAGE_KEYS: Readonly<Record<string, string>> = {
  one_workspace_collapse_state: 'aionui_workspace_collapse_state',
  one_sider_collapsed: 'aionui_sider_collapsed',
  one_theme: 'aionui_theme',
  one_language: 'aionui_language',
  __one_theme: '__aionui_theme',
  one_workspace_update_time: 'aionui_workspace_update_time',
  'one:recent-workspaces': 'aionui:recent-workspaces',
  'one:web-fs-picker:last-dir': 'aionui:web-fs-picker:last-dir',
  'one.emoji.recent': 'aionui.emoji.recent',
  'one.sttStreamUnsupported': 'aionui.sttStreamUnsupported',
  'one.migration-invite-shown': 'aionui.migration-invite-shown',
  // Found by reading a real install's localStorage, not by grepping source.
  // Both are plain literals -- they were simply outside the surface the first
  // sweep walked (a cron page hook and a history-tree hook, neither of which
  // looks like storage code from its path). Grepping the prefix across the
  // whole renderer is the cheap check that would have caught them.
  one_cron_unread: 'aionui_cron_unread',
  one_workspace_expansion: 'aionui_workspace_expansion',
};

/**
 * Copy any legacy entry whose current key is still unset. Idempotent, and safe
 * to call when `localStorage` is unavailable (WebUI in a locked-down browser,
 * or a test environment without one).
 */
export const migrateLegacyLocalStorageKeys = (): void => {
  let storage: Storage;
  try {
    if (typeof localStorage === 'undefined') return;
    storage = localStorage;
  } catch {
    return;
  }

  for (const [current, legacy] of Object.entries(LEGACY_LOCAL_STORAGE_KEYS)) {
    try {
      if (storage.getItem(current) !== null) continue;
      const value = storage.getItem(legacy);
      if (value !== null) storage.setItem(current, value);
    } catch {
      // A single unreadable key must not stop the rest from migrating.
    }
  }
};
