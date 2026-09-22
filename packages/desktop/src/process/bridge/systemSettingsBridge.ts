/**
 * Copyright 2026 One Work
 */

/**
 * 系统设置桥接模块
 * System Settings Bridge Module
 *
 * 负责���理系统级设置的读写操作（如关闭到托盘）
 * Handles read/write operations for system-level settings (e.g. close to tray)
 */

import { ipcBridge } from '@/common';
import { getWebSearchProvider, resolveWebSearchBaseUrl } from '@/common/webSearch/catalog';
import { WEB_SEARCH_ADAPTERS, runProviderSearch } from '@process/resources/builtinMcp/webSearchProviders';
import { changeLanguage } from '@process/services/i18n';
import { createOrUpdateTray, destroyTray, setCloseToTrayEnabled } from '@process/utils/tray';
import { readCloseToTraySetting, writeCloseToTraySetting } from '@process/utils/closeToTraySetting';

type LanguageChangeListener = () => void;
let _languageChangeListener: LanguageChangeListener | null = null;

/**
 * 注册语言变更监听器（供主进程 index.ts 使用）
 * Register a listener for language changes (used by main process index.ts)
 */
export function onLanguageChanged(listener: LanguageChangeListener): void {
  _languageChangeListener = listener;
}

/** A test search should answer fast or not at all — the user is watching a spinner. */
const WEB_SEARCH_TEST_TIMEOUT_MS = 15_000;

/**
 * Prove a provider's key and endpoint actually work, before the user finds out
 * mid-conversation that they do not.
 *
 * Runs the SAME request builder and parser the MCP tool uses
 * (`runProviderSearch`); a test that took a different path could pass while
 * real searches fail, which is the one thing a connectivity test exists to
 * rule out.
 */
async function testWebSearchProvider(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
  options?: Record<string, string>
) {
  const provider = getWebSearchProvider(providerId);
  if (!provider) return { ok: false, message: `Unknown search provider: ${providerId}` };

  const adapter = WEB_SEARCH_ADAPTERS[provider.id];
  if (!adapter) return { ok: false, message: `No adapter implemented for ${provider.label}` };
  if (!apiKey?.trim()) return { ok: false, message: 'No API key entered' };

  const endpoint = baseUrl?.trim() || resolveWebSearchBaseUrl(provider, undefined);
  if (!endpoint) return { ok: false, message: 'No endpoint URL entered' };
  const outcome = await runProviderSearch(
    adapter,
    apiKey.trim(),
    endpoint,
    'hello',
    3,
    WEB_SEARCH_TEST_TIMEOUT_MS,
    options
  );

  if (outcome.ok) {
    const hits = outcome.hits || [];
    // Zero results on a live 200 means the endpoint answered but nothing was
    // parsed out of it — worth flagging, because the key is clearly fine and
    // the user would otherwise see a green tick and no working search.
    if (hits.length === 0) {
      return { ok: false, message: 'Connected, but no results could be read from the response' };
    }
    return { ok: true, message: `OK — ${hits.length} result(s)`, sampleTitle: hits[0].title };
  }

  const detail = (outcome.body || '').slice(0, 200);
  if (outcome.reason === 'timeout')
    return { ok: false, message: `No response within ${WEB_SEARCH_TEST_TIMEOUT_MS / 1000}s` };
  if (outcome.reason === 'network') return { ok: false, message: `Cannot reach ${endpoint} — ${detail}` };
  if (outcome.reason === 'badJson') return { ok: false, message: `Endpoint did not return JSON — ${detail}` };
  const status = outcome.status || 0;
  // A 401 can also mean the endpoint belongs to a different service than the
  // key does — Ark answered 401 to a valid Doubao-search key. Say both.
  const hint =
    status === 401 || status === 403
      ? 'key rejected, or this endpoint is for a different service'
      : status === 429
        ? 'rate limited'
        : 'request failed';
  return { ok: false, message: `HTTP ${status} (${hint}) — ${detail}` };
}

export function initSystemSettingsBridge(): void {
  ipcBridge.webSearch.test.provider(async ({ providerId, apiKey, baseUrl, options }) =>
    testWebSearchProvider(providerId, apiKey, baseUrl, options)
  );
  ipcBridge.systemSettings.getCloseToTray.provider(async () => readCloseToTraySetting());

  ipcBridge.systemSettings.setCloseToTray.provider(async ({ enabled }) => {
    await writeCloseToTraySetting(enabled);
    setCloseToTrayEnabled(enabled);
    if (enabled) {
      createOrUpdateTray();
    } else {
      destroyTray();
    }
  });

  // 语言变更通知，同步主进程 i18n 并通知托盘重建
  // Language change notification, sync main process i18n and notify tray rebuild
  ipcBridge.systemSettings.changeLanguage.provider(async ({ language }) => {
    // Broadcast to all renderers FIRST (desktop + WebUI) for real-time sync.
    // This must happen before the potentially slow main-process i18n switch.
    ipcBridge.systemSettings.languageChanged.emit({ language });
    _languageChangeListener?.();

    // Update main process i18n (non-blocking – don't let a hang here block the provider)
    changeLanguage(language).catch((error) => {
      console.error('[SystemSettings] Main process changeLanguage failed:', error);
    });
  });
}
