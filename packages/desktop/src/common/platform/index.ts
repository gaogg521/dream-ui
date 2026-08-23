import path from 'path';
import type { IPlatformServices } from './IPlatformServices';
import { NodePlatformServices } from './NodePlatformServices';

let _services: IPlatformServices | null = null;

/**
 * Resolve the dev-mode app name for environment isolation.
 * Centralised so that every call-site stays in sync.
 */
export function getDevAppName(): string {
  const isMultiInstance = process.env.DREAM_MULTI_INSTANCE === '1';
  return isMultiInstance ? '1one-Dev-2' : '1one-Dev';
}

/**
 * Stable on-disk identity for the PRODUCTION userData directory.
 *
 * Electron derives `app.getName()` (and therefore the userData path) from
 * `productName` when no explicit name is set. Rebranding `productName` to
 * "One Work" would relocate `%APPDATA%\<name>` and orphan every existing
 * user's data (conversations, model keys, config live under userData). We pin
 * the production name to the historical productName so the on-disk path never
 * moves. This value MUST equal the productName shipped before the rebrand.
 */
export const PROD_USERDATA_APP_NAME = '1ONE Code';

/**
 * The product name users actually read. MUST equal `productName` in
 * `packages/desktop/electron-builder.yml`.
 *
 * ⚠️ Import this instead of writing the literal. Every brand leak this project
 * has shipped came from a hardcoded copy in a surface nothing validates —
 * tray tooltips, NSIS strings, `setAppUserModelId`. i18n checks only cover
 * `locales/`, tsc and tests never assert copy, so a stale literal ships silently
 * and is found by a user looking at their screen. A shared constant is the only
 * thing that makes the next rename mechanical.
 *
 * NOT the same as `PROD_USERDATA_APP_NAME` above (that one is pinned to the
 * pre-rebrand name so `%APPDATA%` never moves) and NOT the same as the
 * executable name (`1onecode.exe`, deliberately frozen).
 */
export const BRAND_DISPLAY_NAME = 'One Work';

/**
 * Windows AppUserModelID (and macOS bundle-identifier-adjacent taskbar/dock
 * identity) — separate from `app.getName()`. `setAppUserModelId()` was never
 * called anywhere in this codebase, so Windows fell back to whatever identity
 * the raw `electron.exe` binary carries in dev, which is where a stale/
 * unbranded taskbar tooltip comes from even though the window title and
 * `app.getName()` are both correctly branded. Matches the real
 * `electron-builder.yml` `appId` so a packaged install's taskbar identity is
 * self-consistent; the dev suffix keeps a dev instance from taskbar-grouping
 * with a real installed copy.
 */
export const APP_USER_MODEL_ID = 'com.huanle.oneone.ai';
export const DEV_APP_USER_MODEL_ID = 'com.huanle.oneone.ai.dev';

export function registerPlatformServices(services: IPlatformServices): void {
  _services = services;
}

export function getPlatformServices(): IPlatformServices {
  if (!_services) {
    // In Electron, module-level code in initStorage.ts may execute before the
    // explicit registerPlatformServices(new ElectronPlatformServices()) call
    // because Rollup places the shared chunk require() ahead of side-effect
    // imports in the bundled output. Auto-register an inline implementation using
    // electron.app directly so that all platform API callers work regardless of
    // call order. This will be replaced by the proper ElectronPlatformServices
    // once registerPlatformServices() is called.
    if (process.versions?.electron) {
      // In Electron utility processes process.type === 'utility' and app is not
      // accessible. Fall back to NodePlatformServices (DATA_DIR is injected by
      // ElectronPlatformServices.fork so paths still resolve correctly).
      const processType = (process as NodeJS.Process & { type?: string }).type;
      if (processType !== 'browser') {
        _services = new NodePlatformServices();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app, net } = require('electron') as typeof import('electron');
        // Dev isolation: set app name before any getPath('userData') call.
        // Rollup may load this chunk before configureChromium.ts runs, so we
        // must apply the dev name here as a safety net.
        if (!app.isPackaged) {
          const devAppName = getDevAppName();
          app.setName(devAppName);
          app.setPath('userData', path.join(path.dirname(app.getPath('userData')), devAppName));
          app.setAppUserModelId(DEV_APP_USER_MODEL_ID);
        } else {
          // Production: pin name so a rebranded productName does not move userData.
          app.setName(PROD_USERDATA_APP_NAME);
          app.setPath('userData', path.join(path.dirname(app.getPath('userData')), PROD_USERDATA_APP_NAME));
          app.setAppUserModelId(APP_USER_MODEL_ID);
        }
        // Typed as IPlatformPaths so tsc enforces completeness: any new method
        // added to the interface will cause a compile error here if omitted below.
        const paths: import('./IPlatformServices').IPlatformPaths = {
          getDataDir: () => app.getPath('userData'),
          getTempDir: () => app.getPath('temp'),
          getHomeDir: () => app.getPath('home'),
          getLogsDir: () => {
            try {
              return app.getPath('logs');
            } catch {
              return path.join(app.getPath('userData'), 'logs');
            }
          },
          getAppPath: () => app.getAppPath(),
          isPackaged: () => app.isPackaged,
          getSystemPath: (name) => app.getPath(name),
          getName: () => app.getName(),
          getVersion: () => app.getVersion(),
          needsCliSafeSymlinks: () => process.platform === 'darwin',
        };
        _services = {
          paths,
          worker: {
            fork: () => {
              throw new Error('[Platform] Worker not available before registerPlatformServices()');
            },
          },
          power: { preventSleep: () => null, allowSleep: () => {}, preventDisplaySleep: () => null },
          notification: { send: () => {} },
          network: {
            fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
              net.fetch(input instanceof URL ? input.toString() : input, init),
          },
        };
      }
    } else {
      throw new Error(
        '[Platform] Services not registered. Call registerPlatformServices() before using platform APIs.'
      );
    }
  }
  return _services;
}

export type {
  IPlatformServices,
  IPlatformPaths,
  IWorkerProcess,
  IWorkerProcessFactory,
  IPowerManager,
  INotificationService,
  INetworkService,
} from './IPlatformServices';
