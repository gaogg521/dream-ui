/**
 * Copyright 2026 One Work
 */

/**
 * Runs `officeparser` for one file inside a worker thread instead of the main process.
 *
 * Parsing is where a library import goes wrong: a 13 MB spreadsheet took ~64 s and ~3.7 GB of RAM to turn into
 * 18 M characters of text, and a multi-hundred-MB deck can never finish. Inside the main process that stalls
 * every window and cannot be stopped. In a worker it can be cancelled (`terminate()`), is bounded in time, and
 * its heap is capped, so running out of memory ends the worker instead of the app.
 */
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { electronApp } from '@/common/electronSafe';

// Plain CommonJS source: an eval worker has no bundler, so it loads officeparser by absolute path.
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
(async () => {
  try {
    const { parseOfficeAsync } = require(workerData.modulePath);
    const text = await parseOfficeAsync(await fs.readFile(workerData.filePath));
    parentPort.postMessage({ text });
  } catch (error) {
    parentPort.postMessage({ error: error && error.message ? error.message : String(error) });
  }
})();
`;

export type OfficeWorkerOptions = {
  /** Give up (and free the memory) after this long. */
  timeoutMs: number;
  /** Heap cap for the worker, in MiB. */
  maxHeapMb: number;
  signal?: AbortSignal;
};

const resolveOfficeparser = (): string => {
  const root = electronApp?.getAppPath() ?? process.cwd();
  return createRequire(path.join(root, 'package.json')).resolve('officeparser');
};

export const abortError = (): Error => Object.assign(new Error('Import cancelled'), { name: 'AbortError' });

export function parseOfficeInWorker(filePath: string, options: OfficeWorkerOptions): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { filePath, modulePath: resolveOfficeparser() },
      resourceLimits: { maxOldGenerationSizeMb: options.maxHeapMb },
    });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      settle();
    };
    const onAbort = () => finish(() => reject(abortError()));
    const timer = setTimeout(
      () => finish(() => reject(new Error(`Text extraction timed out after ${Math.round(options.timeoutMs / 1000)}s`))),
      options.timeoutMs
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (message: { text?: string; error?: string }) =>
      finish(() => (message.error !== undefined ? reject(new Error(message.error)) : resolve(message.text ?? '')))
    );
    worker.on('error', (error: Error & { code?: string }) =>
      finish(() =>
        reject(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? new Error('Text extraction ran out of memory (file too large)')
            : error
        )
      )
    );
    worker.on('exit', () => finish(() => reject(new Error('Text extraction stopped unexpectedly'))));
  });
}
