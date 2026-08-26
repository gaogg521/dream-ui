/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  AutoUpdateReadyResult,
  UpdateCheckResult,
  UpdateDownloadCancelRequest,
  UpdateDownloadProgressEvent,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateReleaseInfo,
  GitHubReleaseAsset,
  InstallerLastFailureMarker,
} from '@/common/update/updateTypes';
import { uuid } from '@/common/utils';
import type { UpdateFileInfo, UpdateInfo } from 'electron-updater';
import { app } from 'electron';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';
import { autoUpdaterService } from '../services/autoUpdaterService';
import { consumeInstallerLastFailure } from '../services/installerLastFailure';

/** Lazily loads i18n to avoid pulling in initStorage chain at module load time */
let _i18nCache: Promise<typeof import('../services/i18n')> | null = null;
const getI18n = async () => {
  if (!_i18nCache) {
    _i18nCache = import('../services/i18n');
  }
  const m = await _i18nCache;
  return m.default;
};

/** Parameters for auto-update check via electron-updater */
interface AutoUpdateCheckParams {
  /** Whether to include prerelease/dev builds in update check */
  includePrerelease?: boolean;
}

// The fork's release page — the GitHub repo (gaogg521/1oneUI) is private, so it
// cannot be linked to or queried by unauthenticated clients. See RELEASE_PAGE_URL below.
const DEFAULT_USER_AGENT = 'OneWork';
const ALLOWED_ASSET_EXTS = new Set(['.exe', '.msi', '.dmg', '.zip', '.deb', '.rpm']);
const CDN_HOST = '1onework-1251001122.cos.ap-shanghai.myqcloud.com';
const CDN_BASE_URL = `https://${CDN_HOST}/releases`;
const ALLOWED_DOWNLOAD_HOSTS = new Set<string>([
  CDN_HOST,
  'github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const MAX_REDIRECTS = 8;

const isAllowedAssetName = (name: string) => {
  const ext = path.extname(name);
  return ALLOWED_ASSET_EXTS.has(ext);
};

/**
 * Rewrite a release asset's file name to its CDN URL. The CDN path follows the
 * fixed convention `{base}/{version}/{filename}`, matching electron-builder's
 * artifactName output, so no name conversion is needed.
 */
const rewriteAssetUrlToCDN = (assetName: string, version: string): string => {
  return `${CDN_BASE_URL}/${version}/${assetName}`;
};

/**
 * Maps a single file entry from the electron-updater CDN channel manifest
 * (`latest.yml` / `latest-mac.yml` / …) to the asset shape the renderer expects.
 * `file.url` in that manifest is the bare filename (electron-builder's
 * artifactName output), not a full URL.
 */
const mapChannelAsset = (file: UpdateFileInfo, version: string): GitHubReleaseAsset => {
  const name = path.basename(file.url);
  return {
    name,
    url: rewriteAssetUrlToCDN(name, version),
    size: file.size ?? 0,
  };
};

type RuntimePlatformInfo = {
  platform: NodeJS.Platform;
  arch: string;
};

type CanonicalArch = 'x64' | 'arm64' | 'ia32';

const normalizeArch = (arch: string): CanonicalArch => {
  if (arch === 'arm64') return 'arm64';
  if (arch === 'ia32' || arch === 'x32') return 'ia32';
  return 'x64';
};

const detectAssetArchs = (nameLower: string): Set<CanonicalArch> => {
  const detected = new Set<CanonicalArch>();

  if (/\b(arm64|aarch64)\b/.test(nameLower)) detected.add('arm64');
  if (/\b(x64|x86_64|amd64)\b/.test(nameLower)) detected.add('x64');

  const hasX86Token = /\bx86\b/.test(nameLower) && !/\bx86[_-]?64\b/.test(nameLower);
  if (/\b(ia32|x32|32bit)\b/.test(nameLower) || hasX86Token) detected.add('ia32');

  return detected;
};

const getPlatformHints = (runtime: RuntimePlatformInfo = { platform: process.platform, arch: process.arch }) => {
  const platform = runtime.platform;
  const arch = runtime.arch;
  const normalizedArch = normalizeArch(arch);

  const archHints =
    normalizedArch === 'arm64'
      ? ['arm64', 'aarch64']
      : normalizedArch === 'ia32'
        ? ['ia32', 'x86', 'x32', '32bit']
        : ['x64', 'x86_64', 'amd64'];

  // electron-builder artifact names often include one of these
  const platformHints =
    platform === 'win32' ? ['win', 'win32', 'windows'] : platform === 'darwin' ? ['mac', 'darwin', 'osx'] : ['linux'];

  return { platform, arch, normalizedArch, archHints, platformHints };
};

const scoreAsset = (asset: GitHubReleaseAsset, runtime?: RuntimePlatformInfo): number => {
  const { platform, normalizedArch, archHints, platformHints } = getPlatformHints(runtime);
  const nameLower = asset.name.toLowerCase();
  const ext = path.extname(asset.name);

  const detectedArchs = detectAssetArchs(nameLower);
  if (detectedArchs.size > 0 && !detectedArchs.has(normalizedArch)) {
    return -1;
  }

  let score = 0;

  // Platform match
  if (platformHints.some((hint) => nameLower.includes(hint))) score += 20;

  // Arch match
  if (archHints.some((hint) => nameLower.includes(hint))) score += 10;
  if (detectedArchs.has(normalizedArch)) score += 15;

  // Prefer installer formats per platform
  if (platform === 'win32') {
    if (ext === '.exe') score += 100;
    if (ext === '.msi') score += 90;
    if (ext === '.zip') score += 50;
  } else if (platform === 'darwin') {
    if (ext === '.dmg') score += 100;
    if (ext === '.zip') score += 70;
  } else {
    if (ext === '.deb') score += 100;
    if (ext === '.rpm') score += 80;
    if (ext === '.zip') score += 40;
  }

  return score;
};

export const pickRecommendedAsset = (
  assets: GitHubReleaseAsset[],
  runtime?: RuntimePlatformInfo
): GitHubReleaseAsset | undefined => {
  if (!assets.length) return undefined;

  const scored = assets
    .map((asset) => ({ asset, score: scoreAsset(asset, runtime) }))
    .filter((item) => item.score >= 0)
    .toSorted((a, b) => b.score - a.score);

  return scored[0]?.asset;
};

// The fork's public landing/release page. The GitHub repo is private, so its
// Releases page (previously used here) 404s for end users — never link there.
const RELEASE_PAGE_URL = 'https://work.1oneclaw.com/';

const assertAllowedUrl = async (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error((await getI18n()).t('update.errors.invalidUrl'));
  }

  if (parsed.protocol !== 'https:') {
    throw new Error((await getI18n()).t('update.errors.httpsOnly'));
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error((await getI18n()).t('update.errors.hostNotAllowed', { host: parsed.hostname }));
  }
};

const fetchWithAllowlistedRedirects = async (rawUrl: string, signal: AbortSignal): Promise<Response> => {
  let current = rawUrl;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertAllowedUrl(current);

    const res = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error((await getI18n()).t('update.errors.redirectNoLocation'));
      }
      current = new URL(location, current).toString();
      continue;
    }

    return res;
  }

  throw new Error((await getI18n()).t('update.errors.tooManyRedirects'));
};

/**
 * Release notes published next to the installers, at
 * `releases/{version}/release-notes.md` (written by release-distribute.yml from
 * the GitHub Release body).
 *
 * electron-builder does not put a `releaseNotes` field into the generated
 * `latest*.yml` unless a build-time notes resource exists, so the channel
 * manifest this fork publishes carries none — which left the "更新日志" panel
 * with nothing to show. Fetching the sidecar file keeps the changelog editable
 * after the fact (re-upload one small file, no rebuild).
 *
 * Best-effort and cached per version: a missing file just means "no notes".
 */
const cdnReleaseNotesCache = new Map<string, string>();

const fetchCdnReleaseNotes = async (version: string): Promise<string> => {
  const cached = cdnReleaseNotesCache.get(version);
  if (cached !== undefined) return cached;

  let notes = '';
  try {
    const response = await fetch(`${CDN_BASE_URL}/${version}/release-notes.md`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });
    if (response.ok) {
      const text = (await response.text()).trim();
      // Object storage answers some missing-key requests with an XML error
      // document rather than a plain 404 — never render that as a changelog.
      notes = text.startsWith('<') ? '' : text;
    }
  } catch (error) {
    log.info('[update] release notes sidecar unavailable:', error instanceof Error ? error.message : String(error));
  }

  cdnReleaseNotesCache.set(version, notes);
  return notes;
};

/**
 * Builds the manual-check release description from the electron-updater CDN
 * channel manifest (the same `latest*.yml` the auto-updater already polls) —
 * no separate network call. See `autoUpdaterService.getLastCheckedReleaseInfo()`.
 */
const buildLatestReleaseInfo = (info: UpdateInfo): UpdateReleaseInfo => {
  const assets = (info.files || [])
    .filter((file) => file && file.url && isAllowedAssetName(path.basename(file.url)))
    .map((file) => mapChannelAsset(file, info.version));

  return {
    tagName: `v${info.version}`,
    version: info.version,
    name: typeof info.releaseName === 'string' ? info.releaseName : undefined,
    body: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    htmlUrl: RELEASE_PAGE_URL,
    publishedAt: info.releaseDate,
    prerelease: false,
    draft: false,
    assets,
    recommendedAsset: pickRecommendedAsset(assets),
  };
};

type DownloadState = {
  abortController: AbortController;
  file_path: string;
};

type ActiveManualDownload = {
  downloadId: string;
  file_path: string;
};

const downloads = new Map<string, DownloadState>();
const activeManualDownloads = new Map<string, ActiveManualDownload>();
const manualDownloadKeysById = new Map<string, string>();
const cancelledManualDownloadIds = new Set<string>();

const sanitizeFileName = (name: string): string => {
  // Keep only base name and trim weird whitespace.
  const base = path.basename(name).trim();
  // Avoid empty names.
  return base || `AionUi-update-${Date.now()}`;
};

const ensureUniquePath = (target: string): string => {
  if (!fs.existsSync(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 1; i < 1000; i++) {
    const next = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(next)) return next;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
};

const buildManualDownloadKey = (url: string, fallbackUrl: string | undefined, fileName: string): string => {
  const primary = new URL(url).toString();
  const fallback = fallbackUrl ? new URL(fallbackUrl).toString() : '';
  return [primary, fallback, fileName].join('\n');
};

const emitProgress = (evt: UpdateDownloadProgressEvent) => {
  ipcBridge.update.downloadProgress.emit(evt);
};

const cleanupManualDownload = (downloadId: string) => {
  downloads.delete(downloadId);
  const activeKey = manualDownloadKeysById.get(downloadId);
  if (activeKey) {
    activeManualDownloads.delete(activeKey);
    manualDownloadKeysById.delete(downloadId);
  }
};

type DownloadAttempt = {
  ok: boolean;
  isAbort: boolean;
  message: string;
  receivedBytes: number;
  totalBytes?: number;
};

/**
 * Attempt to download from a single URL into `file_path`.
 * Emits `starting`/`downloading` progress events but NOT the terminal
 * completed/error/cancelled events — the caller decides whether to retry
 * or surface the final state.
 */
const attemptDownload = async (
  downloadId: string,
  url: string,
  file_path: string,
  abortController: AbortController
): Promise<DownloadAttempt> => {
  let receivedBytes = 0;
  let totalBytes: number | undefined;

  const startedAt = Date.now();
  let lastEmitAt = 0;

  const emitThrottled = (status: UpdateDownloadProgressEvent['status']) => {
    const now = Date.now();
    const shouldEmit = now - lastEmitAt >= 250 || status !== 'downloading';
    if (!shouldEmit) return;

    const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
    const bytesPerSecond = receivedBytes / elapsedSec;
    const percent = totalBytes ? Math.min(100, (receivedBytes / totalBytes) * 100) : undefined;

    lastEmitAt = now;
    emitProgress({
      downloadId,
      status,
      receivedBytes,
      totalBytes,
      percent,
      bytesPerSecond,
    });
  };

  emitThrottled('starting');

  log.info('[update-download] Downloading from URL:', url);

  let stream: fs.WriteStream | null = null;
  try {
    const res = await fetchWithAllowlistedRedirects(url, abortController.signal);

    if (!res.ok) {
      throw new Error((await getI18n()).t('update.errors.downloadFailed', { status: res.status }));
    }

    const contentLengthHeader = res.headers.get('content-length');
    if (contentLengthHeader) {
      const parsed = parseInt(contentLengthHeader, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        totalBytes = parsed;
      }
    }

    if (!res.body) {
      throw new Error((await getI18n()).t('update.errors.downloadNoBody'));
    }

    stream = fs.createWriteStream(file_path);
    const reader = res.body.getReader();

    let doneReading = false;
    while (!doneReading) {
      const { done, value } = await reader.read();
      doneReading = done;
      if (doneReading) break;
      if (!value) continue;

      receivedBytes += value.byteLength;

      const buf = Buffer.from(value);
      if (!stream.write(buf)) {
        await new Promise<void>((resolve) => stream?.once('drain', () => resolve()));
      }

      emitThrottled('downloading');
    }

    await new Promise<void>((resolve, reject) => {
      if (!stream) {
        resolve();
        return;
      }
      stream.end(() => resolve());
      stream.on('error', reject);
    });

    return { ok: true, isAbort: false, message: '', receivedBytes, totalBytes };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isAbort = abortController.signal.aborted || message.toLowerCase().includes('aborted');

    try {
      stream?.close();
    } catch {
      // ignore
    }

    // Remove partial file before retrying or reporting failure.
    try {
      if (fs.existsSync(file_path)) {
        fs.rmSync(file_path, { force: true });
      }
    } catch {
      // ignore
    }

    return { ok: false, isAbort, message, receivedBytes, totalBytes };
  }
};

const startDownloadInBackground = async (
  downloadId: string,
  url: string,
  file_path: string,
  abortController: AbortController,
  fallbackUrl?: string
) => {
  const runWithFallback = async (): Promise<DownloadAttempt> => {
    const primary = await attemptDownload(downloadId, url, file_path, abortController);
    if (primary.ok) return primary;
    if (primary.isAbort) return primary;
    if (!fallbackUrl || fallbackUrl === url) return primary;

    try {
      await assertAllowedUrl(fallbackUrl);
    } catch (err) {
      // Fallback URL itself is invalid — keep the primary failure result.
      log.warn('[update-download] Fallback URL rejected by allowlist:', err);
      return primary;
    }

    log.warn(`[update-download] Primary download failed (${primary.message}). Retrying with fallback URL.`);
    return attemptDownload(downloadId, fallbackUrl, file_path, abortController);
  };

  const finalResult = await runWithFallback();

  try {
    if (cancelledManualDownloadIds.has(downloadId)) {
      return;
    }
    if (finalResult.ok) {
      emitProgress({
        downloadId,
        status: 'completed',
        receivedBytes: finalResult.receivedBytes,
        totalBytes: finalResult.totalBytes,
        percent: finalResult.totalBytes
          ? Math.min(100, (finalResult.receivedBytes / finalResult.totalBytes) * 100)
          : undefined,
        file_path,
      });
    } else {
      emitProgress({
        downloadId,
        status: finalResult.isAbort ? 'cancelled' : 'error',
        receivedBytes: finalResult.receivedBytes,
        totalBytes: finalResult.totalBytes,
        error: finalResult.message,
      });
    }
  } finally {
    cleanupManualDownload(downloadId);
    cancelledManualDownloadIds.delete(downloadId);
  }
};

/**
 * Create a status broadcast callback that sends updates via ipcBridge.autoUpdate.status.emit.
 * This is a pure emitter: it does not bind to any specific window.
 * The ipcBridge channel broadcasts to all renderer listeners, so no window guard is needed here.
 */
export function createAutoUpdateStatusBroadcast(): (
  status: import('../services/autoUpdaterService').AutoUpdateStatus
) => void {
  return (status) => {
    ipcBridge.autoUpdate.status.emit(status);
  };
}

export function initUpdateBridge(): void {
  ipcBridge.update.consumeInstallerLastFailure.provider(
    async (): Promise<{ success: boolean; data: InstallerLastFailureMarker | null; msg?: string }> => {
      try {
        return {
          success: true,
          data: await consumeInstallerLastFailure({ appDataDir: app.getPath('appData') }),
        };
      } catch (err: unknown) {
        return { success: false, data: null, msg: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcBridge.update.check.provider(
    async (_params): Promise<{ success: boolean; data?: UpdateCheckResult; msg?: string }> => {
      try {
        const currentVersion = app.getVersion();

        // EN: Versioning note
        // Update comparisons are pure semver: `app.getVersion()` (packaged app version) vs the
        // CDN channel manifest's `version`. The manifest is the same `latest*.yml` the
        // auto-updater already polls (see autoUpdaterService/updateFeed.ts) — this handler reuses
        // whatever it most recently resolved instead of making its own network call. There is no
        // prerelease/dev channel published to the CDN, so `includePrerelease` has no effect here.
        //
        // 中文：版本号说明
        // 更新比较严格使用 semver：`app.getVersion()`（应用自身版本号）对比 CDN 频道清单里的
        // `version`。该清单就是自动更新器已经在轮询的 `latest*.yml`（见 autoUpdaterService /
        // updateFeed.ts）——本处理器直接复用它最近一次解析到的结果，不再单独发网络请求。CDN
        // 上没有发布预发布/dev 频道，所以 `includePrerelease` 在这里不起作用。

        const info = await autoUpdaterService.ensureLatestReleaseInfoChecked();
        const currentSemver = semver.valid(currentVersion) || semver.coerce(currentVersion)?.version;
        if (!info || !currentSemver || !semver.valid(info.version)) {
          return { success: true, data: { currentVersion, updateAvailable: false } };
        }

        const latest = buildLatestReleaseInfo(info);
        if (!latest.body) {
          latest.body = (await fetchCdnReleaseNotes(latest.version)) || undefined;
        }
        const updateAvailable = semver.gt(latest.version, currentSemver);
        return {
          success: true,
          data: {
            currentVersion,
            updateAvailable,
            latest,
          },
        };
      } catch (err: unknown) {
        return { success: false, msg: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcBridge.update.download.provider(
    async (params: UpdateDownloadRequest): Promise<{ success: boolean; data?: UpdateDownloadResult; msg?: string }> => {
      try {
        if (!params?.url) {
          return { success: false, msg: (await getI18n()).t('update.errors.missingUrl') };
        }

        // Defense-in-depth: do not allow arbitrary downloads from renderer.
        // EN: Only allowlisted hosts (CDN + GitHub release hosts) are permitted;
        // each redirect hop is re-validated against the allowlist.
        // 中文：仅允许白名单内的域名（CDN + GitHub release 相关），并手动处理重定向，每一跳都校验白名单。
        await assertAllowedUrl(params.url);
        if (params.fallbackUrl) {
          await assertAllowedUrl(params.fallbackUrl);
        }

        const downloadId = params.downloadId || uuid();
        const abortController = new AbortController();

        const downloadsDir = app.getPath('downloads');
        const urlObj = new URL(params.url);
        const urlName = path.basename(urlObj.pathname);
        const baseName = sanitizeFileName(params.file_name || urlName);
        const activeKey = buildManualDownloadKey(params.url, params.fallbackUrl, baseName);
        const activeDownload = activeManualDownloads.get(activeKey);
        if (activeDownload) {
          return Promise.resolve({ success: true, data: activeDownload });
        }

        const targetPath = ensureUniquePath(path.join(downloadsDir, baseName));
        downloads.set(downloadId, { abortController, file_path: targetPath });
        activeManualDownloads.set(activeKey, { downloadId, file_path: targetPath });
        manualDownloadKeysById.set(downloadId, activeKey);

        // Start background download, but return immediately so the UI stays responsive.
        void startDownloadInBackground(downloadId, params.url, targetPath, abortController, params.fallbackUrl);

        return Promise.resolve({ success: true, data: { downloadId, file_path: targetPath } });
      } catch (err: unknown) {
        return Promise.resolve({ success: false, msg: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  ipcBridge.update.cancelDownload.provider(
    async (params: UpdateDownloadCancelRequest): Promise<{ success: boolean; msg?: string }> => {
      try {
        const downloadId = params?.downloadId;
        if (!downloadId) {
          return { success: false, msg: (await getI18n()).t('update.errors.missingDownloadId') };
        }

        const activeDownload = downloads.get(downloadId);
        if (!activeDownload) {
          return { success: true };
        }

        cancelledManualDownloadIds.add(downloadId);
        activeDownload.abortController.abort();
        emitProgress({
          downloadId,
          status: 'cancelled',
          receivedBytes: 0,
          file_path: activeDownload.file_path,
        });
        cleanupManualDownload(downloadId);

        return { success: true };
      } catch (err: unknown) {
        return { success: false, msg: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // Auto-updater IPC handlers (electron-updater)
  ipcBridge.autoUpdate.check.provider(
    async (
      params: AutoUpdateCheckParams
    ): Promise<{
      success: boolean;
      data?: { updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } };
      msg?: string;
    }> => {
      try {
        // Set prerelease preference before checking
        const includePrerelease = Boolean(params?.includePrerelease);
        autoUpdaterService.setAllowPrerelease(includePrerelease);

        const result = await autoUpdaterService.checkForUpdates();
        if (result.success && result.updateInfo) {
          // autoUpdaterService.checkForUpdates() only returns updateInfo when
          // electron-updater confirms isUpdateAvailable, so we can trust it directly.
          return {
            success: true,
            data: {
              updateInfo: {
                version: result.updateInfo.version,
                releaseDate: result.updateInfo.releaseDate,
                releaseNotes:
                  typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : undefined,
              },
            },
          };
        }
        return { success: result.success, msg: result.error };
      } catch (err: unknown) {
        return { success: false, msg: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcBridge.autoUpdate.download.provider(async (): Promise<{ success: boolean; msg?: string }> => {
    try {
      const result = await autoUpdaterService.downloadUpdate();
      return { success: result.success, msg: result.error };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.autoUpdate.restoreDownloaded.provider(
    async (): Promise<{ success: boolean; data: AutoUpdateReadyResult; msg?: string }> => {
      try {
        const result = await autoUpdaterService.restoreDownloadedUpdateIfAvailable();
        return { success: result.success, data: result.data, msg: result.error };
      } catch (err: unknown) {
        return {
          success: false,
          data: { ready: false },
          msg: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  ipcBridge.autoUpdate.cancelDownload.provider(async (): Promise<{ success: boolean; msg?: string }> => {
    try {
      const result = await autoUpdaterService.cancelDownload();
      return { success: result.success, msg: result.error };
    } catch (err: unknown) {
      return { success: false, msg: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcBridge.autoUpdate.quitAndInstall.provider(async (): Promise<void> => {
    await autoUpdaterService.quitAndInstall();
  });
}
