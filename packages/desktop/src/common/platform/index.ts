import path from 'path';
import type { IPlatformServices } from './IPlatformServices';
import { NodePlatformServices } from './NodePlatformServices';

let _services: IPlatformServices | null = null;

/**
 * Resolve the dev-mode app name for environment isolation.
 * Centralised so that every call-site stays in sync.
 *
 * ⚠️ MUST NOT collide with the pre-fork repo's dev app names (`1one-Dev` /
 * `1one-Dev-2` in `1oneUI`). Both repos are deliberately kept checked out
 * side by side on the same dev machines going forward, and their dev-mode
 * `getDevAppName()` used to be byte-identical copy-paste — which meant
 * `bun run dev` in either repo silently pointed at the SAME `%APPDATA%`
 * profile (and, for anyone opting into `*_MULTI_INSTANCE=1`, the same
 * secondary one too). dream-core's newer migrations then got applied to
 * 1oneUI's real multi-month dev/test conversation history, which the old
 * (pre-fork) aioncore binary can no longer open — see
 * `docs/guides/session-2026-08-24-dev-userdata-collision.zh-CN.md`. This
 * repo now uses a name no other repo can plausibly reuse.
 */
export function getDevAppName(): string {
  const isMultiInstance = process.env.DREAM_MULTI_INSTANCE === '1';
  return isMultiInstance ? 'dream-ui-Dev-2' : 'dream-ui-Dev';
}

/**
 * On-disk identity for the PRODUCTION userData directory — the folder that holds
 * every user's conversations, model keys, licence and config.
 *
 * As of 3.0.0 this is "One Work" (=== BRAND_DISPLAY_NAME). Earlier builds shipped
 * it as "1ONE Code" (see LEGACY_PROD_USERDATA_APP_NAMES). Electron derives
 * `app.getName()` — and therefore the userData path — from `productName` unless a
 * name is set explicitly, so `configureChromium.ts` / `getPlatformServices()`
 * call `app.setName()` + `app.setPath('userData', …)` with the value returned by
 * `migrateAndResolveProdUserDataDir()` before any userData access.
 */
export const PROD_USERDATA_APP_NAME = 'One Work';

/**
 * Legacy production userData directory names this fork has shipped, newest
 * first. Consumed only by `migrateAndResolveProdUserDataDir` to find a pre-3.0
 * directory to move onto `PROD_USERDATA_APP_NAME` on first launch.
 *
 * ⚠️ Only names unambiguously owned by THIS fork belong here. Do NOT add
 * "AionUi" — that is upstream's directory name, and a user running both apps
 * would have their upstream data hijacked.
 */
export const LEGACY_PROD_USERDATA_APP_NAMES: readonly string[] = ['1ONE Code'];

/**
 * Move a legacy-named production userData directory onto `PROD_USERDATA_APP_NAME`
 * and return the directory to use. `appSupportDir` is the PARENT directory
 * (macOS: `~/Library/Application Support`, Windows: `%APPDATA%`).
 *
 * - target already exists                 → use it (no-op)
 * - legacy dir exists, target does not     → rename legacy → target, use target
 * - rename fails (locked / cross-device)   → use the legacy dir in place
 *                                            (never lose access to the data)
 * - nothing exists                         → return target path (fresh install)
 *
 * Must run in the main process, before any `app.getPath('userData')` call.
 */
export function migrateAndResolveProdUserDataDir(appSupportDir: string): string {
  // Lazy require: this module is shared with the renderer bundle, which must not
  // pull in 'fs' at the top level. Every caller of this function is main-only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  const isDir = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  const target = path.join(appSupportDir, PROD_USERDATA_APP_NAME);
  if (isDir(target)) return target;

  for (const legacyName of LEGACY_PROD_USERDATA_APP_NAMES) {
    const legacyPath = path.join(appSupportDir, legacyName);
    if (legacyPath === target || !isDir(legacyPath)) continue;
    try {
      fs.renameSync(legacyPath, target);
      console.log(`[platform] migrated userData directory: "${legacyName}" -> "${PROD_USERDATA_APP_NAME}"`);
      return target;
    } catch (error) {
      console.warn(
        `[platform] could not migrate userData "${legacyName}" -> "${PROD_USERDATA_APP_NAME}"; using the legacy directory in place`,
        error
      );
      return legacyPath;
    }
  }
  return target;
}

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
 * As of 3.0.0 this equals `PROD_USERDATA_APP_NAME` (the userData directory was
 * migrated off the historical "1ONE Code"). It is still a separate constant:
 * the two answer different questions (what the user reads vs. where data lives)
 * and could diverge again. `appId` (`com.huanle.oneone.ai`) is a third, frozen
 * identity — Squirrel.Mac update matching and the Windows uninstall registry key
 * are derived from it.
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
          // Production: pin the userData directory to PROD_USERDATA_APP_NAME,
          // migrating a legacy-named directory ("1ONE Code") on first launch.
          app.setName(PROD_USERDATA_APP_NAME);
          app.setPath('userData', migrateAndResolveProdUserDataDir(path.dirname(app.getPath('userData'))));
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
