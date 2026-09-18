import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

const makeAppDataDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'onework-installer-last-failure-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  const fs = await import('node:fs/promises');
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('installerLastFailure service', () => {
  it('still consumes a marker left at the pre-rebrand path by an older installer', async () => {
    // A failed install leaves the marker written by the OLD installer, and it is only
    // read once the NEW app starts — so the upgrade run must still find the old
    // directory, or that failure notice is silently lost exactly when it matters.
    const { consumeInstallerLastFailure, getLegacyInstallerLastFailureMarkerPaths } =
      await import('@/process/services/installerLastFailure');
    const appDataDir = makeAppDataDir();
    const [legacyPath] = getLegacyInstallerLastFailureMarkerPaths(appDataDir);

    await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(legacyPath), { recursive: true }));
    writeFileSync(
      legacyPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'app-cannot-be-closed',
        phase: 'customCheckAppRunning',
        silent: true,
        updated: true,
        retryCount: 1,
        instDir: 'D:\One Work',
        logPath: 'C:\Users\me\AppData\Local\Temp\onework-installer.log',
        at: '2026-07-01T00:00:00.000Z',
      })
    );

    const consumed = await consumeInstallerLastFailure({ appDataDir });

    expect(consumed).toMatchObject({ schemaVersion: 1, kind: 'app-cannot-be-closed' });
    expect(existsSync(legacyPath)).toBe(false);
    await expect(consumeInstallerLastFailure({ appDataDir })).resolves.toBeNull();
  });

  it('consumes a valid installer-last-failure marker once from the AppData brand directory', async () => {
    const { consumeInstallerLastFailure, getInstallerLastFailureMarkerPath } =
      await import('@/process/services/installerLastFailure');
    const appDataDir = makeAppDataDir();
    const markerPath = getInstallerLastFailureMarkerPath(appDataDir);

    await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(markerPath), { recursive: true }));
    writeFileSync(
      markerPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: 'app-cannot-be-closed',
        phase: 'customCheckAppRunning',
        silent: true,
        updated: true,
        retryCount: 3,
        instDir: 'D:\\OneWork',
        logPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\onework-installer-2.1.27-20260702-151830-ab12cd34ef56.log',
        at: '2026-07-01T00:00:00.000Z',
        blockers: [{ pid: 1234, name: 'OneWork.exe' }],
      })
    );

    const consumed = await consumeInstallerLastFailure({ appDataDir });

    expect(consumed).toMatchObject({
      schemaVersion: 1,
      kind: 'app-cannot-be-closed',
      phase: 'customCheckAppRunning',
      silent: true,
      updated: true,
      retryCount: 3,
      instDir: 'D:\\OneWork',
      logPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\onework-installer-2.1.27-20260702-151830-ab12cd34ef56.log',
      at: '2026-07-01T00:00:00.000Z',
    });
    expect(consumed?.blockers).toEqual([{ pid: 1234, name: 'OneWork.exe' }]);
    expect(existsSync(markerPath)).toBe(false);
    await expect(consumeInstallerLastFailure({ appDataDir })).resolves.toBeNull();
  });

  it('does not consume malformed marker JSON', async () => {
    const { consumeInstallerLastFailure, getInstallerLastFailureMarkerPath } =
      await import('@/process/services/installerLastFailure');
    const appDataDir = makeAppDataDir();
    const markerPath = getInstallerLastFailureMarkerPath(appDataDir);

    await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(markerPath), { recursive: true }));
    writeFileSync(markerPath, JSON.stringify({ schemaVersion: 1, kind: 'wrong-kind' }));

    await expect(consumeInstallerLastFailure({ appDataDir })).resolves.toBeNull();
    expect(readFileSync(markerPath, 'utf8')).toContain('wrong-kind');
  });

  it('consumes a valid UTF-8 BOM-prefixed marker written by Windows PowerShell', async () => {
    const { consumeInstallerLastFailure, getInstallerLastFailureMarkerPath } =
      await import('@/process/services/installerLastFailure');
    const appDataDir = makeAppDataDir();
    const markerPath = getInstallerLastFailureMarkerPath(appDataDir);

    await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(markerPath), { recursive: true }));
    writeFileSync(
      markerPath,
      `\uFEFF${JSON.stringify({
        schemaVersion: 1,
        kind: 'app-cannot-be-closed',
        phase: 'customCheckAppRunning',
        silent: true,
        updated: true,
        retryCount: 3,
        instDir: 'D:\\OneWork',
        logPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\onework-installer-2.1.27-20260702-151830-ab12cd34ef56.log',
        at: '2026-07-01T00:00:00.000Z',
      })}`,
      'utf8'
    );

    await expect(consumeInstallerLastFailure({ appDataDir })).resolves.toMatchObject({
      kind: 'app-cannot-be-closed',
      logPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\onework-installer-2.1.27-20260702-151830-ab12cd34ef56.log',
    });
    expect(existsSync(markerPath)).toBe(false);
  });
});
