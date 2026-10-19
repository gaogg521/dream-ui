/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ locale: 'zh-CN' as string | (() => never) }));

vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: { get: vi.fn(async () => undefined) } }));
vi.mock('@/common/electronSafe', () => ({
  electronApp: {
    getLocale: () => {
      if (typeof state.locale === 'function') return state.locale();
      return state.locale;
    },
  },
}));

import i18n from 'i18next';
import { setInitialLanguage } from '@process/services/i18n';

describe('main-process language when the user never picked one', () => {
  beforeEach(async () => {
    state.locale = 'zh-CN';
    await setInitialLanguage('en-US');
  });

  it('follows the OS language, the same fallback the renderer uses, so the tray menu is not English next to a Chinese window', async () => {
    await setInitialLanguage(undefined);
    expect(i18n.t('common.tray.showWindow')).toBe('显示 One Work');
  });

  it('still honours an explicit choice over the OS language', async () => {
    await setInitialLanguage('en-US');
    expect(i18n.t('common.tray.showWindow')).toBe('Show One Work');
  });

  it('stays on the current language when the OS language cannot be read', async () => {
    state.locale = () => {
      throw new Error('app not ready');
    };
    await setInitialLanguage(undefined);
    expect(i18n.t('common.tray.showWindow')).toBe('Show One Work');
  });
});
