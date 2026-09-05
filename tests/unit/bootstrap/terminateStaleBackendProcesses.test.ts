/**
 * The matching logic of the stale-backend killer.
 *
 * `recoverCorruptedDatabase.test.ts` injects a stub for this function, so it
 * pins the CALL ORDER and nothing about who actually gets signalled. That gap
 * is what let the POSIX branch ship as `pkill -f -- <dataDir>`: no process-name
 * filter and a regex-interpreted pattern, so it would have killed a
 * `tail -f <dataDir>/logs/…` or an editor opened on that folder — contradicting
 * this module's own contract that only dreamcore is ever touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const DATA_DIR = '/Users/dev/Library/Application Support/dream-ui/1one';

/** `ps -Ao pid=,command=` output with one real backend and several decoys. */
const PS_OUTPUT = [
  `  101 /Applications/One Work.app/Contents/MacOS/One Work`,
  `  202 /Applications/One Work.app/Contents/Resources/bundled-dreamcore/dreamcore --port 0 --data-dir ${DATA_DIR}`,
  `  303 tail -f ${DATA_DIR}/logs/server.log`,
  `  404 /usr/local/bin/code ${DATA_DIR}`,
  `  505 /opt/other/dreamcore --data-dir /Users/dev/other-profile/1one`,
  '',
].join('\n');

async function loadModule() {
  vi.resetModules();
  return import('@/process/startup/terminateStaleBackendProcesses');
}

describe('terminateStaleBackendProcesses (POSIX matching)', () => {
  let killed: number[];
  let killSpy: ReturnType<typeof vi.spyOn>;
  const realPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    killed = [];
    killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      killed.push(pid);
      return true;
    }) as never);
    execFileMock.mockReset();
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, PS_OUTPUT, '');
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  });

  it('signals only a dreamcore that names THIS data dir', async () => {
    const { terminateStaleBackendProcesses } = await loadModule();
    const count = await terminateStaleBackendProcesses(DATA_DIR);

    expect(killed).toEqual([202]);
    expect(count).toBe(1);
  });

  it('never signals a non-dreamcore process that merely names the data dir', async () => {
    const { terminateStaleBackendProcesses } = await loadModule();
    await terminateStaleBackendProcesses(DATA_DIR);

    // 303 is the developer's own `tail`, 404 an editor. Both name the path.
    expect(killed).not.toContain(303);
    expect(killed).not.toContain(404);
  });

  it('never signals a dreamcore pointed at a different data dir', async () => {
    const { terminateStaleBackendProcesses } = await loadModule();
    await terminateStaleBackendProcesses(DATA_DIR);

    expect(killed).not.toContain(505);
  });

  it('lists processes rather than shelling out to pkill', async () => {
    const { terminateStaleBackendProcesses } = await loadModule();
    await terminateStaleBackendProcesses(DATA_DIR);

    const [command] = execFileMock.mock.calls[0] as [string, string[]];
    expect(command).toBe('ps');
    expect(execFileMock.mock.calls.some(([cmd]) => cmd === 'pkill')).toBe(false);
  });

  it('never signals itself, whatever its command line says', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, `  ${process.pid} dreamcore --data-dir ${DATA_DIR}\n`, '');
    });
    const { terminateStaleBackendProcesses } = await loadModule();
    const count = await terminateStaleBackendProcesses(DATA_DIR);

    expect(killed).toEqual([]);
    expect(count).toBe(0);
  });

  it('reports zero rather than throwing when listing fails', async () => {
    execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('ps unavailable'), '', '');
    });
    const { terminateStaleBackendProcesses } = await loadModule();

    await expect(terminateStaleBackendProcesses(DATA_DIR)).resolves.toBe(0);
  });
});
