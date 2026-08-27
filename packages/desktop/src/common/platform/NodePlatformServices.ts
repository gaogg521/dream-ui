import { fork as cpFork, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { IPlatformServices, IWorkerProcess } from './IPlatformServices';

class NodeWorkerProcess implements IWorkerProcess {
  constructor(private readonly cp: ChildProcess) {}

  postMessage(message: unknown): void {
    this.cp.send(message as Parameters<ChildProcess['send']>[0]);
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    this.cp.on(event, handler as (...args: unknown[]) => void);
    return this;
  }

  kill(): void {
    this.cp.kill();
  }
}

// Read name + version from package.json once at module load.
const _pkg = (() => {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      name?: string;
      version?: string;
    };
  } catch {
    return { name: 'one', version: '0.0.0' };
  }
})();

/**
 * Data directory for headless (non-Electron) runs.
 *
 * Prefers the current name but keeps using the pre-rebrand directory when that
 * is the one on disk: pointing a running server at a fresh empty directory does
 * not fail, it just comes up with none of its data.
 */
const serverDir = (): string => {
  const home = os.homedir();
  const current = path.join(home, '.one-server');
  if (existsSync(current)) return current;
  const legacy = path.join(home, '.aionui-server');
  return existsSync(legacy) ? legacy : current;
};

export class NodePlatformServices implements IPlatformServices {
  paths = {
    getDataDir: () => process.env.DATA_DIR ?? serverDir(),
    getTempDir: () => os.tmpdir(),
    getHomeDir: () => os.homedir(),
    getLogsDir: () => process.env.LOGS_DIR ?? path.join(serverDir(), 'logs'),
    getAppPath: (): string | null => process.cwd(),
    isPackaged: () => process.env.IS_PACKAGED === 'true',
    getSystemPath: (_name: 'desktop' | 'home' | 'downloads'): string | null => null,
    getName: () => _pkg.name ?? 'one',
    getVersion: () => _pkg.version ?? '0.0.0',
    needsCliSafeSymlinks: () => false,
  };

  worker = {
    fork: (modulePath: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }): IWorkerProcess =>
      new NodeWorkerProcess(
        cpFork(modulePath, args, {
          cwd: opts.cwd,
          env: opts.env,
          // Enables V8 structured clone (supports Buffer, Map, Set).
          // ArrayBuffer ownership transfer is not supported — acceptable
          // because current IForkData messages contain no Transferables.
          serialization: 'advanced',
        })
      ),
  };

  power = {
    preventSleep: (): number | null => null,
    allowSleep: (_id: number | null): void => {},
    preventDisplaySleep: (): number | null => null,
  };

  notification = {
    send: (_opts: { title: string; body: string; icon?: string }): void => {},
  };

  network = {
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> => fetch(input, init),
  };
}
