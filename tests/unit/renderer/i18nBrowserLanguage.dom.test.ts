/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Before login a plain browser cannot read the saved language (the settings call answers 401), so the
// first paint has to follow the browser's own language. The Electron app is untouched: it keeps using
// its saved/injected language and the system hint only when the backend failed to start.
vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: () => Promise.reject(new Error('401')),
    get: () => undefined,
    set: async () => undefined,
  },
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    systemSettings: {
      languageChanged: { on: () => () => undefined },
      changeLanguage: { invoke: async () => undefined },
    },
  },
}));

const setBrowserLanguage = (languages: string[]) => {
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true });
  Object.defineProperty(window.navigator, 'language', { value: languages[0], configurable: true });
};

const loadFresh = async () => {
  vi.resetModules();
  const mod = await import('@/renderer/services/i18n');
  return mod.default;
};

describe('initial language in a plain browser', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { electronAPI?: unknown }).electronAPI;
    delete (window as { __initialLanguage?: unknown }).__initialLanguage;
  });
  afterEach(() => {
    localStorage.clear();
    delete (window as { electronAPI?: unknown }).electronAPI;
  });

  it('follows a Chinese browser on a first visit instead of showing English', async () => {
    setBrowserLanguage(['zh-CN', 'zh', 'en']);
    expect((await loadFresh()).language).toBe('zh-CN');
  });

  it('maps a Traditional-Chinese browser to zh-TW and other languages to theirs', async () => {
    setBrowserLanguage(['zh-HK']);
    expect((await loadFresh()).language).toBe('zh-TW');
    setBrowserLanguage(['ja']);
    expect((await loadFresh()).language).toBe('ja-JP');
  });

  it('falls back to English for a language the app does not have', async () => {
    setBrowserLanguage(['sv-SE']);
    expect((await loadFresh()).language).toBe('en-US');
  });

  it('a language this browser already chose wins over the browser language', async () => {
    setBrowserLanguage(['zh-CN']);
    localStorage.setItem('i18nextLng', 'de-DE');
    expect((await loadFresh()).language).toBe('de-DE');
  });

  it('does not use the browser language inside the Electron app', async () => {
    setBrowserLanguage(['zh-CN']);
    (window as { electronAPI?: unknown }).electronAPI = {};
    expect((await loadFresh()).language).toBe('en-US');
  });
});
