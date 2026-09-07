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
 * Marker files that record the user's answer to the one-time "your data is in
 * the old directory — import it?" prompt (`process/startup/legacyUserDataImport.ts`).
 *
 * The prompt exists for people who launched the broken 3.0.1: their profile at
 * `PROD_USERDATA_APP_NAME` is real (Chromium wrote to it, dreamcore seeded a
 * database) so the empty-stub rule below correctly refuses to overwrite it,
 * yet everything they care about is still sitting in the legacy directory.
 *
 * Both markers live INSIDE the legacy directory, never in the current one:
 *
 * - the request marker has to survive that directory being renamed onto the
 *   target, because the rename is what it is asking for. It travels with the
 *   data and is deleted the moment the swap lands.
 * - the decline marker has to survive in the one place that is still checked,
 *   so a "no" is remembered and the prompt never returns.
 */
export const LEGACY_USERDATA_IMPORT_REQUESTED_MARKER = '.onework-import-requested';
export const LEGACY_USERDATA_IMPORT_DECLINED_MARKER = '.onework-import-declined';

/**
 * Where the backend catalog sits inside a userData directory — the same
 * `<userData>/1one` that `process/utils/utils.ts` `getDataPath()` builds. Named
 * here because the import check needs it before any of that module's
 * Electron-dependent code can run.
 */
export const USERDATA_DATA_SUBDIR = '1one';

/**
 * Written into the userData directory right after it is MOVED, naming the
 * absolute path it was moved from.
 *
 * Renaming the directory is only half of the job: conversations, skills, media
 * assets and queued media jobs all persist ABSOLUTE paths that were captured
 * under the old name, and a rename silently invalidates every one of them. The
 * user sees it as "Agent failed to run in this workspace path — make sure
 * <old path> exists", on a path that no longer does.
 *
 * The move happens before app-ready, where opening the SQLite catalog is not
 * an option; the rewrite runs later (`process/startup/repairMovedUserDataPaths.ts`).
 * This file is what carries the old root across that gap, and it survives a
 * crash in between — it is deleted only once the repair has finished.
 */
export const USERDATA_MOVED_FROM_MARKER = '.userdata-moved-from';

/**
 * Move a legacy-named production userData directory onto `PROD_USERDATA_APP_NAME`
 * and return the directory to use. `appSupportDir` is the PARENT directory
 * (macOS: `~/Library/Application Support`, Windows: `%APPDATA%`, Linux:
 * `~/.config`) — i.e. exactly `app.getPath('appData')`.
 *
 * - target exists AND is non-empty         → use it (no-op)
 * - target absent, or an empty stub        → migrate a legacy dir onto it
 * - rename fails (locked / cross-device)   → use the legacy dir in place
 *                                            (never lose access to the data)
 * - nothing exists                         → return target path (fresh install)
 *
 * ⚠️ Callers MUST derive `appSupportDir` from `app.getPath('appData')`, never
 * from `path.dirname(app.getPath('userData'))`. Electron's path provider
 * *creates* the userData directory as a side effect of resolving it (verified:
 * `getPath('userData')` on a name with no directory returns a path that exists
 * immediately afterwards), so reading the parent that way materialises an empty
 * `<appData>/One Work` before this function ever runs. That is what shipped in
 * 3.0.1: the target always existed, the branch below always short-circuited,
 * and every upgrading user got a blank profile while their conversations, model
 * providers and licence sat untouched in `1ONE Code`.
 *
 * The empty-stub check below is defence in depth for the same failure: anything
 * that creates the directory ahead of us (a reordered import, Chromium's
 * crashpad, a launch that died before writing) must not be able to cancel the
 * migration again.
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

  // Unreadable counts as non-empty: a directory we cannot list is one we must
  // not assume is a throwaway stub.
  const isEmptyDir = (p: string): boolean => {
    try {
      return fs.readdirSync(p).length === 0;
    } catch {
      return false;
    }
  };

  const target = path.join(appSupportDir, PROD_USERDATA_APP_NAME);

  // Someone who ran the broken 3.0.1 has a real-but-blank profile at `target`
  // and their actual data still in the legacy directory. The stub rule below
  // will not touch a non-empty target — correctly, since we cannot tell a
  // blank profile from a used one — so they are recovered by an explicit
  // prompt instead, whose "yes" is recorded as a marker inside the legacy
  // directory. The swap itself happens HERE rather than where the question was
  // asked: this is the last moment in startup at which nothing has opened a
  // file under either directory, and on Windows a directory with open handles
  // cannot be renamed.
  const requested = findRequestedImportSource(fs, isDir, appSupportDir, target);
  if (requested && swapInLegacyUserDataDir(fs, requested, target)) return target;

  const targetIsEmptyStub = isDir(target) && isEmptyDir(target);
  if (isDir(target) && !targetIsEmptyStub) return target;

  for (const legacyName of LEGACY_PROD_USERDATA_APP_NAMES) {
    const legacyPath = path.join(appSupportDir, legacyName);
    if (legacyPath === target || !isDir(legacyPath)) continue;
    try {
      // `renameSync` onto an existing directory fails on Windows even when it
      // is empty. rmdirSync only ever removes an empty directory — if anything
      // wrote into it between the check and here it throws, and we fall
      // through to using the legacy directory in place rather than deleting
      // data we did not inspect.
      if (targetIsEmptyStub) fs.rmdirSync(target);
      fs.renameSync(legacyPath, target);
      recordUserDataMove(fs, legacyPath, target);
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
 * Leave a note saying where this directory came from, for the path repair that
 * runs once the app is ready. Best-effort: a move that happened without the
 * note is still a move, and the app must not refuse to start over a file it
 * could not write. The cost of losing it is the stale-path errors staying,
 * which is the state we were already in.
 */
function recordUserDataMove(fs: typeof import('fs'), from: string, to: string): void {
  try {
    fs.writeFileSync(path.join(to, USERDATA_MOVED_FROM_MARKER), from);
  } catch (error) {
    console.warn(
      `[platform] could not record the userData move from "${from}"; stale paths will not be repaired`,
      error
    );
  }
}

/**
 * A legacy profile worth offering to import, or null.
 *
 * Used by the one-time recovery prompt (`process/startup/legacyUserDataImport.ts`).
 * Lives here, with no Electron import, so the decision is testable on its own —
 * it is the guard on an operation that moves the user's entire data directory.
 *
 * Every condition is a reason NOT to ask:
 * - it is the directory we are already running from (the migration fell back
 *   in place), so importing it into itself would mean nothing;
 * - it holds no backend catalog, so there is nothing to recover;
 * - the user has already answered.
 */
export function findImportableLegacyUserDataDir(appSupportDir: string, currentUserDataDir: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  const isDir = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  // The backend catalog is the one artifact whose presence means the app has
  // actually run in a directory. Both names, because dreamcore itself resolves
  // the current one and falls back to the pre-rebrand one.
  const hasBackendCatalog = (dir: string): boolean =>
    ['one-backend.db', 'aionui-backend.db'].some((name) => fs.existsSync(path.join(dir, USERDATA_DATA_SUBDIR, name)));

  const current = path.resolve(currentUserDataDir);
  for (const legacyName of LEGACY_PROD_USERDATA_APP_NAMES) {
    const legacyPath = path.join(appSupportDir, legacyName);
    if (path.resolve(legacyPath) === current) continue;
    if (!isDir(legacyPath)) continue;
    if (!hasBackendCatalog(legacyPath)) continue;
    if (fs.existsSync(path.join(legacyPath, LEGACY_USERDATA_IMPORT_DECLINED_MARKER))) continue;
    if (fs.existsSync(path.join(legacyPath, LEGACY_USERDATA_IMPORT_REQUESTED_MARKER))) continue;
    return legacyPath;
  }
  return null;
}

/**
 * The legacy directory whose import the user has explicitly asked for, or null.
 *
 * Deliberately narrow: only a directory that still carries the request marker
 * counts, and only while it is not already the directory we are running from.
 */
function findRequestedImportSource(
  fs: typeof import('fs'),
  isDir: (p: string) => boolean,
  appSupportDir: string,
  target: string
): string | null {
  for (const legacyName of LEGACY_PROD_USERDATA_APP_NAMES) {
    const legacyPath = path.join(appSupportDir, legacyName);
    if (legacyPath === target || !isDir(legacyPath)) continue;
    if (fs.existsSync(path.join(legacyPath, LEGACY_USERDATA_IMPORT_REQUESTED_MARKER))) return legacyPath;
  }
  return null;
}

/**
 * Put `source` in the place of `target`, keeping whatever was at `target`.
 *
 * Returns false — leaving both directories exactly as they were — when either
 * rename fails. The marker is left in place on failure so the next launch
 * retries; the usual cause is another instance of the app still holding the
 * profile, which the next clean boot resolves by itself.
 *
 * The displaced profile is renamed aside, never deleted. It is small (a blank
 * install) but it is still the user's, and this code has exactly one chance to
 * be wrong about which directory mattered.
 */
function swapInLegacyUserDataDir(fs: typeof import('fs'), source: string, target: string): boolean {
  const displaced = `${target}.superseded-${Date.now()}`;
  const targetExists = fs.existsSync(target);
  if (targetExists) {
    try {
      fs.renameSync(target, displaced);
    } catch (error) {
      console.warn(`[platform] could not move "${target}" aside for the requested import; keeping it`, error);
      return false;
    }
  }
  try {
    fs.renameSync(source, target);
  } catch (error) {
    console.warn(`[platform] could not import "${source}"; restoring the previous profile`, error);
    if (targetExists) {
      try {
        fs.renameSync(displaced, target);
      } catch (restoreError) {
        // Both renames failed and the profile now sits at `displaced`. Say so
        // loudly with the real path: the data is intact and one manual rename
        // puts it back, but nothing else in the app will mention it.
        console.error(
          `[platform] profile left at "${displaced}" — rename it back to "${target}" to restore it`,
          restoreError
        );
      }
    }
    return false;
  }
  recordUserDataMove(fs, source, target);
  try {
    fs.rmSync(path.join(target, LEGACY_USERDATA_IMPORT_REQUESTED_MARKER), { force: true });
  } catch {
    // A leftover marker is harmless: the directory it would point at no longer
    // exists, so findRequestedImportSource stops finding it either way.
  }
  console.log(`[platform] imported legacy userData "${source}" -> "${target}" (previous profile: "${displaced}")`);
  return true;
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
          // getPath('appData') — never dirname(getPath('userData')), which
          // would create the target and cancel the migration. See
          // migrateAndResolveProdUserDataDir.
          app.setPath('userData', migrateAndResolveProdUserDataDir(app.getPath('appData')));
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
