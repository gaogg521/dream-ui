/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UpdateCheckResult, UpdateInfo } from 'electron-updater';

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => {
      const handlerMap = new Map<string, Function>();
      return {
        provider: vi.fn((handler: Function) => {
          handlerMap.set('handler', handler);
          return vi.fn();
        }),
        invoke: vi.fn(),
        _getHandler: () => handlerMap.get('handler'),
      };
    }),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    exit: vi.fn(),
    isPackaged: true,
  },
  autoUpdater: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

/**
 * The `update.check` handler no longer calls the (private, 404-for-end-users) GitHub
 * Releases API — it reuses whatever the electron-updater CDN feed already resolved
 * (see autoUpdaterService.getLastCheckedReleaseInfo()). So the fixture here is a CDN
 * channel manifest (`UpdateInfo`, the parsed shape of `latest.yml`), not a GitHub API response.
 */
const makeUpdateInfo = (): UpdateInfo => ({
  version: '1.9.22',
  releaseDate: '2026-04-29T00:00:00Z',
  releaseNotes: 'release notes',
  files: [
    { url: 'AionUi-1.9.22-mac-arm64.dmg', sha512: 'sha-mac', size: 123 },
    { url: 'AionUi-1.9.22-win-x64.exe', sha512: 'sha-win', size: 456 },
    { url: 'AionUi-1.9.22-linux-amd64.deb', sha512: 'sha-linux', size: 789 },
  ],
  path: 'AionUi-1.9.22-win-x64.exe',
  sha512: 'sha-win',
});

const getCheckHandlerWithUpdateInfo = async (updateInfo: UpdateInfo) => {
  vi.resetModules();

  const { autoUpdater } = await import('electron-updater');
  vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
    isUpdateAvailable: true,
    updateInfo,
    versionInfo: updateInfo,
  } as UpdateCheckResult);

  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');
  const { autoUpdaterService } = await import('@process/services/autoUpdaterService');

  autoUpdaterService.initialize();
  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.update.check.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.check handler not registered');
  return lastCall[0];
};

const getAutoUpdateQuitAndInstallHandler = async () => {
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.autoUpdate.quitAndInstall.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('autoUpdate.quitAndInstall handler not registered');
  return lastCall[0];
};

const makeDeferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

// The fork's check flow reuses the auto-updater's already-polled UpdateInfo and
// rewrites asset URLs to the fork's own CDN (COS). GitHub is never called — the
// repo is private and would 404 for an unauthenticated request.
describe('updateBridge CDN URL rewriting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rewrites CDN channel manifest file names to CDN asset URLs and skips the GitHub API entirely', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandlerWithUpdateInfo(makeUpdateInfo());
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.data?.currentVersion).toBe('1.0.0');
      // No GitHub API call is made — the private gaogg521/1oneUI repo would 404 for it.
      expect(fetchMock).not.toHaveBeenCalled();

      expect(result.data?.latest?.htmlUrl).toBe('https://work.1oneclaw.com/');

      const assets = result.data?.latest?.assets ?? [];
      expect(assets.length).toBe(3);

      const macAsset = assets.find((a: { name: string }) => a.name === 'AionUi-1.9.22-mac-arm64.dmg');
      expect(macAsset).toBeDefined();
      expect(macAsset?.url).toBe(
        'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/1.9.22/AionUi-1.9.22-mac-arm64.dmg'
      );

      const linuxAsset = assets.find((a: { name: string }) => a.name === 'AionUi-1.9.22-linux-amd64.deb');
      expect(linuxAsset?.url).toBe(
        'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/1.9.22/AionUi-1.9.22-linux-amd64.deb'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses the normalized version (no v prefix) in the CDN path', async () => {
    const handler = await getCheckHandlerWithUpdateInfo(makeUpdateInfo());
    const result = await handler({});
    const asset = result.data?.latest?.assets?.[0];
    expect(asset?.url).toMatch(/^https:\/\/1onework-1251001122\.cos\.ap-shanghai\.myqcloud\.com\/releases\/1\.9\.22\//);
    expect(asset?.url).not.toMatch(/\/v1\.9\.22\//);
  });
});

describe('updateBridge allowlist includes CDN host', () => {
  it('accepts the fork CDN host URLs for download', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '0' }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { initUpdateBridge } = await import('@process/bridge/updateBridge');
      const { ipcBridge } = await import('@/common');

      initUpdateBridge();

      const provider = vi.mocked(ipcBridge.update.download.provider);
      const lastCall = provider.mock.calls.at(-1);
      if (!lastCall) throw new Error('update.download handler not registered');
      const handler = lastCall[0];

      const result = await handler({
        downloadId: 'manual-download-1',
        url: 'https://1onework-1251001122.cos.ap-shanghai.myqcloud.com/releases/1.9.22/AionUi-1.9.22-mac-arm64.dmg',
        file_name: 'AionUi-1.9.22-mac-arm64.dmg',
      });

      expect(result.success).toBe(true);
      expect(result.data?.downloadId).toBe('manual-download-1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects non-allowlisted hosts', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const { initUpdateBridge } = await import('@process/bridge/updateBridge');
    const { ipcBridge } = await import('@/common');

    initUpdateBridge();

    const provider = vi.mocked(ipcBridge.update.download.provider);
    const lastCall = provider.mock.calls.at(-1);
    if (!lastCall) throw new Error('update.download handler not registered');
    const handler = lastCall[0];

    const result = await handler({
      url: 'https://evil.example.com/fake.dmg',
      file_name: 'fake.dmg',
    });

    // Download is refused before any network I/O; exact error text comes from i18n and isn't asserted here.
    expect(result.success).toBe(false);
  });
});

describe('autoUpdate quitAndInstall lifecycle', () => {
  const originalPlatform = process.platform;

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: platform,
    });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    setPlatform('win32');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    setPlatform(originalPlatform);
  });

  it('waits for the pre-install cleanup before starting the installer', async () => {
    const cleanup = makeDeferred();
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => cleanup.promise);

    const installPromise = autoUpdaterService.quitAndInstall();
    await Promise.resolve();

    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    cleanup.resolve();
    await installPromise;

    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('does not start the installer when the pre-install cleanup fails', async () => {
    const cleanupError = new Error('backend did not stop');
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => {
      throw cleanupError;
    });

    await expect(autoUpdaterService.quitAndInstall()).rejects.toThrow('backend did not stop');
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the IPC request pending until quitAndInstall cleanup completes', async () => {
    const cleanup = makeDeferred();
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => cleanup.promise);

    const handler = await getAutoUpdateQuitAndInstallHandler();
    let handlerSettled = false;
    const handlerPromise = handler().then(() => {
      handlerSettled = true;
    });

    await Promise.resolve();

    expect(handlerSettled).toBe(false);

    cleanup.resolve();
    await handlerPromise;

    expect(handlerSettled).toBe(true);
  });

  it('propagates quitAndInstall failures through IPC', async () => {
    const cleanupError = new Error('native readiness failed');
    const { autoUpdaterService } = await import('@process/services/autoUpdaterService');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => {
      throw cleanupError;
    });

    const handler = await getAutoUpdateQuitAndInstallHandler();

    await expect(handler()).rejects.toThrow('native readiness failed');
  });
});
