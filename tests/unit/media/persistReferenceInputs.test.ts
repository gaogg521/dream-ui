/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * A reference image uploaded for image-to-image or image-to-video lands in the
 * OS temp directory, which the system sweeps on its own schedule. The job
 * outlives it — the card shows that image as "what this was made from" and
 * Regenerate feeds the same path back — so once temp is cleaned both break at a
 * moment unrelated to anything the user did.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { persistReferenceInputs } from '@/process/services/mediaJob';

describe('persistReferenceInputs', () => {
  let workspaceDir: string;
  let volatileDir: string;

  beforeEach(async () => {
    // realpath: the Windows CI runner's tmpdir() is an 8.3 short path, while
    // persistReferenceInputs canonicalizes to the long form.
    workspaceDir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'refs-ws-')));
    volatileDir = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'refs-tmp-')));
  });

  afterEach(async () => {
    for (const dir of [workspaceDir, volatileDir]) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  const writeRef = (dir: string, name = 'ref.png') => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, Buffer.from('not-really-a-png'));
    return p;
  };

  it('copies a reference from outside the workspace and points the job at the copy', async () => {
    const original = writeRef(volatileDir);

    const [kept] = await persistReferenceInputs([original], workspaceDir);

    expect(kept).not.toBe(original);
    expect(path.relative(workspaceDir, kept).startsWith('..')).toBe(false);
    expect(fs.existsSync(kept)).toBe(true);
  });

  /** The whole point: the job's copy has to outlive the temp directory. */
  it('leaves the job usable after the original location is wiped', async () => {
    const original = writeRef(volatileDir);
    const [kept] = await persistReferenceInputs([original], workspaceDir);

    await fs.promises.rm(volatileDir, { recursive: true, force: true });

    expect(fs.existsSync(original)).toBe(false);
    expect(fs.readFileSync(kept).toString()).toBe('not-really-a-png');
  });

  /** Copying a file that already lives here would just duplicate it. */
  it('leaves a reference that is already inside the workspace untouched', async () => {
    const inside = writeRef(workspaceDir);

    const [kept] = await persistReferenceInputs([inside], workspaceDir);

    expect(kept).toBe(inside);
    expect(fs.existsSync(path.join(workspaceDir, 'refs'))).toBe(false);
  });

  it('passes remote and inlined references through without touching disk', async () => {
    const inputs = ['https://cdn.example.com/a.png', 'data:image/png;base64,AAAA'];

    expect(await persistReferenceInputs(inputs, workspaceDir)).toEqual(inputs);
    expect(fs.existsSync(path.join(workspaceDir, 'refs'))).toBe(false);
  });

  /**
   * Bookkeeping must not cost a generation: if the copy cannot be made, the
   * caller's own path still works today and the job should go ahead.
   */
  it('falls back to the caller path when the source cannot be read', async () => {
    const missing = path.join(volatileDir, 'gone.png');

    expect(await persistReferenceInputs([missing], workspaceDir)).toEqual([missing]);
  });

  it('keeps several references distinct rather than colliding on one name', async () => {
    const a = writeRef(volatileDir, 'same.png');
    const other = await fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'refs-tmp2-')));
    const b = writeRef(other, 'same.png');

    const kept = await persistReferenceInputs([a, b], workspaceDir);

    expect(new Set(kept).size).toBe(2);
    await fs.promises.rm(other, { recursive: true, force: true });
  });

  it('does nothing at all when there are no references', async () => {
    expect(await persistReferenceInputs([], workspaceDir)).toEqual([]);
  });
});
