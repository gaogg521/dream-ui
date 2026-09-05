/**
 * Best-effort termination of leftover dreamcore processes that still hold the
 * data directory while the app is trying to RECOVER a corrupted database.
 *
 * Why this exists (N2): the most common precursor to the corrupted-database
 * dialog is a crash — which is also the most common way to end up with a
 * dreamcore from the dead session still running and holding
 * `one-backend.db` open. The recovery's backup-then-rebuild then fails with
 * "os error 32 (file in use)" and the whole dialog is a dead end. Killing the
 * stale backends first lets the recovery actually run.
 *
 * Identification: the instance lock file is an empty flock by design (no pid
 * file), so the holder cannot be read from it. Instead, dreamcore processes
 * are matched by their command line: every backend this app spawns carries
 * `--data-dir <dir>`, so any dreamcore whose command line names OUR data dir
 * is holding OUR database. A dreamcore pointed at a DIFFERENT data directory
 * (another app instance, another environment) is never touched.
 */

import { execFile } from 'node:child_process';

const EXEC_TIMEOUT_MS = 10_000;

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

async function execCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: EXEC_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
      // Non-zero exit with empty output usually means "no processes matched"
      // (pkill/pgrep semantics) — that is a success for this purpose.
      if (error && stdout) {
        resolve(stdout);
        return;
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function terminateStaleBackendProcessesWindows(dataDir: string): Promise<number> {
  const needle = escapePowerShellSingleQuoted(dataDir);
  // One round-trip: list matching dreamcore PIDs and force-kill them. Case
  //-insensitive Contains instead of -like so path characters like [ ] cannot
  // act as wildcards.
  const script = [
    "$targets = Get-CimInstance Win32_Process -Filter \"Name='dreamcore.exe'\" | Where-Object {",
    `$_.CommandLine -and $_.CommandLine.IndexOf('${needle}', [System.StringComparison]::OrdinalIgnoreCase) -ge 0`,
    '} | Select-Object -ExpandProperty ProcessId;',
    '$targets | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue };',
    '($targets -join ",")',
  ].join(' ');
  const stdout = await execCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const ids = stdout
    .trim()
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  return ids.length;
}

async function terminateStaleBackendProcessesUnix(dataDir: string): Promise<number> {
  // pkill -f matches the full command line; dreamcore always carries
  // --data-dir <dir>. Exit code 1 simply means nothing matched.
  await execCommand('pkill', ['-f', '--', dataDir]);
  // The count is not worth a second pgrep round-trip on a best-effort path.
  return 0;
}

/** Kill every dreamcore process whose command line references `dataDir`.
 * Returns how many were signalled (best-effort; failures never throw — the
 * recovery attempt that follows will surface a real error if a holder
 * survived). */
export async function terminateStaleBackendProcesses(dataDir: string): Promise<number> {
  try {
    if (process.platform === 'win32') {
      return await terminateStaleBackendProcessesWindows(dataDir);
    }
    return await terminateStaleBackendProcessesUnix(dataDir);
  } catch (error) {
    // Best-effort by contract: a missed kill shows up as the recovery's own
    // "file in use" failure, which is now surfaced to the user (N3) instead
    // of being silently swallowed here.
    console.warn('[1ONE] terminateStaleBackendProcesses failed (best-effort):', error);
    return 0;
  }
}
