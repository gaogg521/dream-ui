/**
 * Resolve the dreamcore binary path.
 *
 * Search order:
 *  1. DREAM_BACKEND_BIN env override (path, resolved to absolute)
 *  2. Bundled with app (production)
 *  3. System PATH
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const BINARY_NAME = 'dreamcore';
// Backend bundles published before the rebrand shipped the binary (and its
// enclosing resources dir) under the legacy `aioncore` name. Keep resolving
// them so a not-yet-rebuilt dev bundle or an in-place upgrade still boots.
const LEGACY_BINARY_NAME = 'aioncore';
const BUNDLED_DIR_NAMES = ['bundled-dreamcore', 'bundled-aioncore'] as const;
const BIN_ENV_VAR = 'DREAM_BACKEND_BIN';
const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryResolveDiagnostics = {
  envOverridePath?: string;
  envOverrideExists?: boolean;
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  checkedBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function binaryExt(): string {
  return process.platform === 'win32' ? '.exe' : '';
}

function getBinaryName(): string {
  return `${BINARY_NAME}${binaryExt()}`;
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

/**
 * Resolve the dreamcore binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
export function resolveBinaryPath(): string {
  const runtimeKey = getRuntimeKey();
  const binaryName = getBinaryName();
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName,
    pathLookupCommand: process.platform === 'win32' ? `where ${BINARY_NAME}` : `which ${BINARY_NAME}`,
  };

  const override = envOverridePath(diagnostics);
  if (override) return override;

  const bundled = resolveBundledBinary(runtimeKey, binaryName, diagnostics);
  if (bundled) return bundled;

  const fromPath = resolveFromSystemPATH(diagnostics);
  if (fromPath) return fromPath;

  throw new BackendBinaryResolveError(
    `Cannot find "${BINARY_NAME}" (or legacy "${LEGACY_BINARY_NAME}") binary. Checked bundled location and system PATH.`,
    diagnostics
  );
}

/**
 * Honor the DREAM_BACKEND_BIN env override.
 * The value is resolved to an absolute path (relative to process.cwd) so it
 * survives the backend launcher spawning with a different working directory.
 * Returns the path when it points at an existing file. When the variable is
 * set but the file is missing, throws so a typo fails loudly instead of
 * silently falling back to the bundled or PATH binary.
 */
function envOverridePath(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  const raw = process.env[BIN_ENV_VAR]?.trim();
  if (!raw) return null;

  const absolute = resolve(raw);
  diagnostics.envOverridePath = absolute;
  const exists = existsSync(absolute);
  diagnostics.envOverrideExists = exists;
  if (exists) return absolute;

  throw new BackendBinaryResolveError(
    `${BIN_ENV_VAR} is set to "${raw}" but no file exists at "${absolute}".`,
    diagnostics
  );
}

/**
 * Resolve bundled binary. Search order:
 *  1. DREAM_BACKEND_BUNDLED_DIR (explicit override)
 *  2. {cwd}/resources/bundled-dreamcore (dev — backend-rebuild output; the
 *     legacy bundled-aioncore dir is still honored)
 *  3. process.resourcesPath/bundled-dreamcore (packaged app; in dev this is
 *     node_modules/electron/dist/resources and is often stale)
 */
function resolveBundledBinary(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  // Each entry is a bundle dir candidate. The env override points at the
  // bundle dir itself; the standard roots are parents that may hold either
  // bundle dir name.
  const bundleDirs: Array<{ dir: string; currentName: boolean }> = [];
  const envBundledDir = process.env.DREAM_BACKEND_BUNDLED_DIR?.trim();
  if (envBundledDir) bundleDirs.push({ dir: envBundledDir, currentName: true });
  for (const root of [join(process.cwd(), 'resources'), (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath]) {
    if (!root) continue;
    for (const dirName of BUNDLED_DIR_NAMES) {
      bundleDirs.push({ dir: join(root, dirName), currentName: dirName === BUNDLED_DIR_NAMES[0] });
    }
  }

  const binaryNames =
    binaryName === `${BINARY_NAME}${binaryExt()}` ? [`${BINARY_NAME}${binaryExt()}`, `${LEGACY_BINARY_NAME}${binaryExt()}`] : [binaryName];
  const primaryName = binaryNames[0];
  for (const { dir: bundledDir, currentName } of bundleDirs) {
    const runtimeDir = join(bundledDir, runtimeKey);
    for (const name of binaryNames) {
      const candidate = join(runtimeDir, name);
      // Diagnostics follow the primary name in the current-name bundle dir
      // (the standard location); legacy-name fallback attempts are noise.
      if (name === primaryName && currentName) {
        diagnostics.resourcesPath = join(bundledDir, '..');
        diagnostics.checkedBundledPath = candidate;
        diagnostics.bundledDirExists = existsSync(bundledDir);
        diagnostics.runtimeDirExists = existsSync(runtimeDir);
        diagnostics.resourcesDirEntries = listDirEntries(diagnostics.resourcesPath);
        diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);
      }
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Try to find the binary on the system PATH.
 */
function resolveFromSystemPATH(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  try {
    const result = execSync(diagnostics.pathLookupCommand, { encoding: 'utf-8', timeout: 5000 }).trim();
    diagnostics.pathLookupResult = trimLookupText(result);
    const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
    if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
  } catch (error) {
    diagnostics.pathLookupError = error instanceof Error ? trimLookupText(error.message) : String(error);
    return null;
  }
  return null;
}

export type { BackendBinaryResolveDiagnostics };
