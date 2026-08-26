/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generated media lands in `<workspace>/outputs/`, not the workspace root.
 *
 * Two things have to stay true at once and they pull in opposite directions:
 * the bytes go in the subdirectory (so a conversation that makes a dozen images
 * does not bury the files the user actually works on), while the asset keeps
 * describing itself relative to the *workspace*. `jobBelongsToWorkspace` matches
 * a job to its conversation on the workspace path, so anything that quietly
 * turns it into the subdirectory takes every media card's thumbnail, actions and
 * cost line down with it — which is exactly the failure mode this whole change
 * set exists to fix.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MEDIA_OUTPUT_SUBDIR, mediaOutputDir, saveBase64MediaAsset } from '@/common/media/mediaAssets';

const PNG_BASE64 = Buffer.from('not-really-a-png').toString('base64');

describe('generated media output directory', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'media-out-ws-'));
  });

  afterEach(async () => {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  });

  it('writes a generated image into the outputs subdirectory', async () => {
    const asset = await saveBase64MediaAsset('image', PNG_BASE64, workspaceDir);

    expect(path.dirname(asset.filePath)).toBe(mediaOutputDir(workspaceDir));
    expect(fs.existsSync(asset.filePath)).toBe(true);
  });

  it('creates the outputs directory when it does not exist yet', async () => {
    expect(fs.existsSync(mediaOutputDir(workspaceDir))).toBe(false);

    await saveBase64MediaAsset('image', PNG_BASE64, workspaceDir);

    expect(fs.statSync(mediaOutputDir(workspaceDir)).isDirectory()).toBe(true);
  });

  it('reports the path relative to the workspace, not to the outputs directory', async () => {
    const asset = await saveBase64MediaAsset('image', PNG_BASE64, workspaceDir);

    // Not `img-….png` — the workspace is the anchor, so the subdirectory shows.
    expect(asset.relativePath.split(path.sep)[0]).toBe(MEDIA_OUTPUT_SUBDIR);
  });

  it('keeps a multi-output batch together in one outputs directory', async () => {
    const first = await saveBase64MediaAsset('image', PNG_BASE64, workspaceDir, 0);
    const second = await saveBase64MediaAsset('image', PNG_BASE64, workspaceDir, 1);

    expect(path.dirname(second.filePath)).toBe(path.dirname(first.filePath));
    expect(second.filePath).not.toBe(first.filePath);
  });

  it('fails loudly when the workspace cannot be written to', async () => {
    const missingWorkspace = path.join(workspaceDir, 'gone', '\0invalid');

    await expect(saveBase64MediaAsset('image', PNG_BASE64, missingWorkspace)).rejects.toThrow(/Failed to save image/);
  });
});
