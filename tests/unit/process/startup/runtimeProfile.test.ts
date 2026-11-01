import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureAppDataProfile, isPackagedTestRun, TEST_APP_USER_MODEL_ID } from '@/common/platform';
import { getPlatformServices, registerPlatformServices } from '@/common/platform';
import { NodePlatformServices } from '@/common/platform/NodePlatformServices';
import { getConfigPath, getDataPath, getTempPath } from '@/process/utils/utils';

describe('packaged test identity', () => {
  it.each([
    'D:\\dream\\dream-ui\\out\\win-unpacked\\onework.exe',
    'C:/work/out/win-arm64-unpacked/onework.exe',
    '/home/dev/out/linux-unpacked/onework',
    '/Users/dev/out/mac-arm64/One Work.app/Contents/MacOS/onework',
  ])('isolates direct launches from %s', (executable) => {
    expect(isPackagedTestRun(true, executable, {}, [], () => true)).toBe(true);
  });
  it.each([
    'C:/Users/test/AppData/Local/Programs/onework/onework.exe',
    '/Applications/One Work.app/Contents/MacOS/onework',
    '/opt/onework/onework',
  ])('keeps installed releases on production data: %s', (executable) => {
    expect(isPackagedTestRun(true, executable, {}, [])).toBe(false);
  });
  it('supports explicitly isolated copies outside the build output', () => {
    expect(isPackagedTestRun(true, 'C:/qa/onework.exe', { DREAM_TEST_PROFILE: '1' }, [])).toBe(true);
    expect(isPackagedTestRun(true, 'C:/qa/onework.exe', {}, ['--test-profile'])).toBe(true);
    expect(isPackagedTestRun(false, 'C:/qa/electron.exe', { DREAM_TEST_PROFILE: '1' }, [])).toBe(false);
    expect(isPackagedTestRun(true, 'C:/qa/onework.exe', { DREAM_E2E_TEST: '1' }, [])).toBe(true);
  });
  it('does not reset portable users just because their folder is named win-unpacked', () => {
    expect(isPackagedTestRun(true, 'D:/apps/out/win-unpacked/onework.exe', {}, [], () => false)).toBe(false);
  });
});

describe('profile selection and production data retention', () => {
  let root: string;
  const makeApp = (isPackaged = true, version = '3.0.16') => ({
    isPackaged,
    getVersion: () => version,
    getPath: vi.fn((_name: 'appData') => root),
    setName: vi.fn(),
    setPath: vi.fn(),
    setAppUserModelId: vi.fn(),
  });
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onework-profile-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('leaves production and legacy import requests untouched during a packaged test launch', () => {
    const production = path.join(root, 'One Work');
    const legacy = path.join(root, '1ONE Code');
    fs.mkdirSync(production);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(production, 'config.json'), 'existing model config');
    fs.writeFileSync(path.join(legacy, '.onework-import-requested'), '');
    const app = makeApp();
    configureAppDataProfile(app, { DREAM_TEST_PROFILE: '1' }, 'D:/qa/out/win-unpacked/onework.exe', []);
    expect(app.setPath.mock.calls[0][1]).toMatch(/One Work-Test[\\/]3\.0\.16[\\/]/);
    expect(fs.readFileSync(path.join(production, 'config.json'), 'utf8')).toBe('existing model config');
    expect(fs.existsSync(path.join(legacy, '.onework-import-requested'))).toBe(true);
    expect(app.setAppUserModelId).toHaveBeenCalledWith(TEST_APP_USER_MODEL_ID);
  });
  it('keeps existing database and configuration paths stable across installed upgrades', () => {
    const production = path.join(root, 'One Work');
    fs.mkdirSync(path.join(production, '1one'), { recursive: true });
    fs.writeFileSync(path.join(production, '1one/one-backend.db'), 'existing conversations');
    fs.writeFileSync(path.join(production, 'config.json'), 'existing settings');
    const oldApp = makeApp(true, '3.0.14');
    const newApp = makeApp(true, '3.0.16');
    for (const app of [oldApp, newApp]) configureAppDataProfile(app, {}, 'C:/Programs/onework/onework.exe', []);
    expect(newApp.setPath.mock.calls).toEqual(oldApp.setPath.mock.calls);
    expect(fs.readFileSync(path.join(production, '1one/one-backend.db'), 'utf8')).toBe('existing conversations');
    expect(fs.readFileSync(path.join(production, 'config.json'), 'utf8')).toBe('existing settings');
  });
  it('resolves test profiles consistently on repeated initialization, independently by version and location', () => {
    const app = makeApp();
    configureAppDataProfile(app, { DREAM_TEST_PROFILE: '1' }, 'D:/qa/out/win-unpacked/onework.exe', []);
    configureAppDataProfile(app, { DREAM_TEST_PROFILE: '1' }, 'D:/qa/out/win-unpacked/onework.exe', []);
    const older = makeApp(true, '3.0.14');
    configureAppDataProfile(older, { DREAM_TEST_PROFILE: '1' }, 'D:/qa/out/win-unpacked/onework.exe', []);
    const copy = makeApp();
    configureAppDataProfile(copy, { DREAM_TEST_PROFILE: '1' }, 'D:/other/out/win-unpacked/onework.exe', []);
    expect(app.setPath.mock.calls[0]).toEqual(app.setPath.mock.calls[1]);
    expect(older.setPath.mock.calls[0]).not.toEqual(app.setPath.mock.calls[0]);
    expect(copy.setPath.mock.calls[0]).not.toEqual(app.setPath.mock.calls[0]);
  });
  it.each([true, false])(
    'preserves explicit E2E isolation through both initialization paths (packaged=%s)',
    (packaged) => {
      const app = makeApp(packaged);
      const sandbox = path.join(root, 'sandbox');
      const env = { DREAM_E2E_TEST: '1', DREAM_E2E_USER_DATA_DIR: sandbox };
      configureAppDataProfile(app, env);
      configureAppDataProfile(app, env);
      expect(app.setPath.mock.calls).toEqual([
        ['userData', sandbox],
        ['userData', sandbox],
      ]);
      expect(app.getPath).not.toHaveBeenCalled();
    }
  );
});

describe('secondary storage isolation', () => {
  it('keeps legacy temp files and production CLI links untouched', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onework-secondary-'));
    const previous = getPlatformServices();
    try {
      const home = path.join(root, 'home');
      const production = path.join(root, 'production');
      const profile = path.join(root, 'One Work-Test', 'version', 'location');
      for (const directory of [home, production, path.join(profile, 'config'), path.join(root, 'shared-temp', '1one')])
        fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(production, 'sentinel'), 'production');
      fs.writeFileSync(path.join(root, 'shared-temp', '1one', 'legacy-config'), 'legacy settings');
      fs.symlinkSync(production, path.join(home, '.1one'), 'junction');
      fs.symlinkSync(production, path.join(home, '.1one-config'), 'junction');
      const services = new NodePlatformServices();
      services.paths.getDataDir = () => profile;
      services.paths.getHomeDir = () => home;
      services.paths.getTempDir = () => path.join(root, 'shared-temp');
      services.paths.isPackaged = () => true;
      services.paths.needsCliSafeSymlinks = () => true;
      registerPlatformServices(services);
      expect(getTempPath()).toBe(path.join(profile, 'tmp', '1one'));
      getDataPath();
      getConfigPath();
      expect([fs.realpathSync(path.join(home, '.1one')), fs.realpathSync(path.join(home, '.1one-config'))]).toEqual([
        production,
        production,
      ]);
      expect(fs.readFileSync(path.join(root, 'shared-temp', '1one', 'legacy-config'), 'utf8')).toBe('legacy settings');
    } finally {
      registerPlatformServices(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
