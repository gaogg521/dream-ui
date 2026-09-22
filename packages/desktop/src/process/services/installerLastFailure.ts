/**
 * Copyright 2026 One Work
 */

import type { InstallerLastFailureMarker } from '@/common/update/updateTypes';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROD_USERDATA_APP_NAME } from '@/common/platform';

export const INSTALLER_LAST_FAILURE_FILE_NAME = 'installer-last-failure.json';

type ConsumeOptions = {
  appDataDir?: string;
  markerPath?: string;
};

const isString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/**
 * 安装器把失败标记写在 `%APPDATA%\<品牌目录>\` 下，应用下次启动时读走并删除。
 * 这是安装器(NSIS)与应用之间的跨进程约定，两侧必须同名 —— 见
 * `resources/windows/installer-process-control.nsh` 的 `$$appDir`。
 *
 * The installer writes its failure marker under `%APPDATA%\<brand dir>\`; the app
 * consumes and deletes it on next start. This is a cross-process contract with NSIS,
 * so both sides must agree — see `$$appDir` in installer-process-control.nsh.
 */
export function getInstallerLastFailureMarkerPath(appDataDir: string): string {
  return path.join(appDataDir, PROD_USERDATA_APP_NAME, INSTALLER_LAST_FAILURE_FILE_NAME);
}

/**
 * 改名前安装器写过的位置。一次失败的安装是**旧**安装器留下的标记，等新应用启动才被读，
 * 所以升级那一次必须还认得老路径，否则用户看不到那条失败提示。
 *
 * Where the pre-rebrand installer wrote it. A failed install leaves the marker from the
 * OLD installer, read only once the NEW app starts — so the upgrade run must still find
 * the old path, or that failure notice is silently lost.
 */
export function getLegacyInstallerLastFailureMarkerPaths(appDataDir: string): string[] {
  return ['AionUi'].map((dir) => path.join(appDataDir, dir, INSTALLER_LAST_FAILURE_FILE_NAME));
}

export function parseInstallerLastFailureMarker(raw: unknown): InstallerLastFailureMarker | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  if (value.schemaVersion !== 1) return null;
  if (value.kind !== 'app-cannot-be-closed') return null;
  if (value.phase !== 'customCheckAppRunning') return null;
  if (value.silent !== true) return null;
  if (value.updated !== true) return null;
  if (typeof value.retryCount !== 'number' || !Number.isFinite(value.retryCount)) return null;
  if (!isString(value.instDir)) return null;
  if (!isString(value.logPath)) return null;
  if (!isString(value.at)) return null;
  if (value.blockers !== undefined && !Array.isArray(value.blockers)) return null;

  return {
    schemaVersion: 1,
    kind: 'app-cannot-be-closed',
    phase: 'customCheckAppRunning',
    silent: true,
    updated: true,
    retryCount: value.retryCount,
    instDir: value.instDir,
    logPath: value.logPath,
    at: value.at,
    ...(Array.isArray(value.blockers) ? { blockers: value.blockers } : {}),
  };
}

const stripUtf8Bom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

export async function consumeInstallerLastFailure(options: ConsumeOptions): Promise<InstallerLastFailureMarker | null> {
  const candidates = options.markerPath
    ? [options.markerPath]
    : options.appDataDir
      ? [
          getInstallerLastFailureMarkerPath(options.appDataDir),
          ...getLegacyInstallerLastFailureMarkerPaths(options.appDataDir),
        ]
      : [];
  if (candidates.length === 0) return null;

  let markerPath = '';
  let text = '';
  for (const candidate of candidates) {
    try {
      text = await fs.readFile(candidate, 'utf8');
      markerPath = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  if (!markerPath) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripUtf8Bom(text));
  } catch {
    return null;
  }

  const marker = parseInstallerLastFailureMarker(parsed);
  if (!marker) return null;

  await fs.rm(markerPath, { force: true });
  return marker;
}
