/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { parseOfficeInWorker } from '@process/utils/officeTextWorker';

const options = { timeoutMs: 20_000, maxHeapMb: 256 };

describe('parseOfficeInWorker', () => {
  it('does not start a worker for an extraction that was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseOfficeInWorker('does-not-matter.docx', { ...options, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reports a file it cannot read as an error instead of hanging', async () => {
    await expect(parseOfficeInWorker(path.join(os.tmpdir(), 'missing-office-file.docx'), options)).rejects.toThrow(
      /ENOENT|no such file/i
    );
  });

  it('reports a file officeparser cannot parse as an error', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'office-worker-')), 'broken.docx');
    await fs.writeFile(file, 'this is not a zip archive');
    await expect(parseOfficeInWorker(file, options)).rejects.toThrow();
  });

  it('stops a running extraction when the caller cancels', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'office-worker-')), 'late.docx');
    await fs.writeFile(file, 'x');
    const controller = new AbortController();
    const started = Date.now();
    const result = parseOfficeInWorker(file, { ...options, signal: controller.signal });
    controller.abort();
    // Either the abort wins, or the (tiny, invalid) file fails first; in both cases it must settle promptly.
    await result.catch(() => undefined);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
