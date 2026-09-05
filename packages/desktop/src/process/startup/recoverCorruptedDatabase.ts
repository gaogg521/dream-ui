import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';

export type RecoverCorruptedDatabaseDeps = {
  getFailure: () => BackendStartupFailureInfo | null;
  stopBackend: () => Promise<void>;
  /** Best-effort kill of leftover dreamcore processes holding the data dir.
   * The crash that corrupted the database is also the likeliest way a stale
   * backend survived; without this the recovery's backup step fails with
   * "file in use" and the dialog is a dead end (N2). */
  terminateStaleBackendProcesses?: () => Promise<unknown>;
  startBackendWithRecovery: () => Promise<number>;
  /** Called when a recovery ATTEMPT failed. The failure state must return to
   * `backend_recoverable_database_corruption` — the database is still corrupt,
   * and without this the reclassified one-off state made every further click
   * a silent no-op (N3). */
  markRecoveryFailed?: (error: unknown) => void;
  markReady: (port: number, source: string) => void;
  reloadMainWindow: () => void;
  logInfo: (message: string) => void;
  logWarn: (message: string) => void;
};

export async function recoverCorruptedDatabaseAfterUserConfirmation(deps: RecoverCorruptedDatabaseDeps): Promise<void> {
  const failure = deps.getFailure();
  if (failure?.reason !== 'backend_recoverable_database_corruption') {
    deps.logWarn('[1ONE] Ignoring corrupted database recovery request outside recoverable failure state.');
    throw new Error('backend_corrupted_database_recovery_not_available');
  }

  deps.logInfo('[1ONE] User confirmed corrupted database backup and rebuild.');
  try {
    await deps.stopBackend();
    await deps.terminateStaleBackendProcesses?.();
    const port = await deps.startBackendWithRecovery();
    deps.markReady(port, 'backendManager.recoverCorruptedDatabase');
    deps.reloadMainWindow();
  } catch (error) {
    deps.logWarn(
      `[1ONE] Corrupted database recovery attempt failed: ${error instanceof Error ? error.message : String(error)}`
    );
    deps.markRecoveryFailed?.(error);
    throw error;
  }
}
