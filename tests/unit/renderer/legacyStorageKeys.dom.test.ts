/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Renaming a localStorage key without moving its value silently resets the
 * user's preferences: nothing errors, the reader just finds nothing and falls
 * back to a default, and the user re-does settings they had already chosen.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEGACY_LOCAL_STORAGE_KEYS, migrateLegacyLocalStorageKeys } from '@renderer/utils/storage/legacyStorageKeys';

describe('migrateLegacyLocalStorageKeys', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('carries a pre-rebrand value over to the current key', () => {
    localStorage.setItem('aionui_theme', 'dark');

    migrateLegacyLocalStorageKeys();

    expect(localStorage.getItem('one_theme')).toBe('dark');
  });

  it('never overwrites a value already stored under the current key', () => {
    localStorage.setItem('one_language', 'en');
    localStorage.setItem('aionui_language', 'zh');

    migrateLegacyLocalStorageKeys();

    expect(localStorage.getItem('one_language')).toBe('en');
  });

  it('leaves the legacy entry in place so a downgrade still finds it', () => {
    localStorage.setItem('aionui_sider_collapsed', 'true');

    migrateLegacyLocalStorageKeys();

    expect(localStorage.getItem('aionui_sider_collapsed')).toBe('true');
  });

  it('writes nothing when there is nothing to carry over', () => {
    migrateLegacyLocalStorageKeys();

    expect(localStorage.length).toBe(0);
  });

  it('is idempotent, so a later change is not reverted by a second run', () => {
    localStorage.setItem('aionui_theme', 'dark');
    migrateLegacyLocalStorageKeys();
    localStorage.setItem('one_theme', 'light');

    migrateLegacyLocalStorageKeys();

    expect(localStorage.getItem('one_theme')).toBe('light');
  });

  /** Every mapping must actually rename — a self-mapping would be a silent no-op. */
  it('maps every current key to a different legacy key', () => {
    for (const [current, legacy] of Object.entries(LEGACY_LOCAL_STORAGE_KEYS)) {
      expect(current, `${current} maps to itself`).not.toBe(legacy);
      expect(legacy).toContain('aionui');
    }
  });
});
