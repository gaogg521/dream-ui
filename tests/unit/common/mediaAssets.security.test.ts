/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `mediaAssets.ts` is the code every media adapter (Form A/B/C, video) is
 * actually wired to today — unlike `common/chat/imageGenCore.ts`, whose own
 * path-traversal tests (`imageGenCore.test.ts`) have kept passing against a
 * file nothing in production imports any more. These tests exercise the
 * live code path directly so a future refactor can't silently repeat that.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isWithin,
  processImageUri,
  resolveLocalInputPath,
  resolveLocalInputPathAllowingTemp,
} from '@/common/media/mediaAssets';

let cleanupDirs: string[] = [];

function createWorkspace(): string {
  // realpathSync: on the Windows CI runner `tmpdir()` is an 8.3 short path
  // (`C:\Users\RUNNER~1\...`) while `resolveLocalInputPath` canonicalizes to
  // the long form — compare against the same canonical form.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aionui-media-assets-test-')));
  cleanupDirs.push(dir);
  return dir;
}

function createImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, PNG_1x1);
  return filePath;
}

afterEach(() => {
  for (const d of cleanupDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  cleanupDirs = [];
});

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const symlinkSupported = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'aionui-symlink-probe-'));
  const target = join(dir, 'target');
  const link = join(dir, 'link');
  try {
    writeFileSync(target, 'probe');
    symlinkSync(target, link);
    return existsSync(link);
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe('resolveLocalInputPath (agent tool-call args — image_uris / first_frame_image / last_frame_image)', () => {
  it('resolves a relative path within the workspace', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    await expect(resolveLocalInputPath('test.png', ws)).resolves.toBe(imgPath);
  });

  it('blocks ../ traversal out of the workspace', async () => {
    const ws = createWorkspace();

    await expect(resolveLocalInputPath('../../../etc/passwd', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('blocks an absolute path pointing outside the workspace', async () => {
    const ws = createWorkspace();
    // This is the actual exploit shape: an agent, steered by content it read
    // (prompt injection), calls the image tool with the app's own database
    // as "image_uris" — before this fix, resolveLocalInputPath returned this
    // path unchanged and the caller read + uploaded it to a remote provider.
    const outside = createWorkspace();
    const secret = createImageFile(outside, 'aionui.db');

    await expect(resolveLocalInputPath(secret, ws)).rejects.toThrow('Path traversal blocked');
  });

  // Only Windows recognizes `C:\...` as absolute — on POSIX it's just a
  // relative filename containing backslashes, which stays inside `ws` and
  // is correctly allowed (not a traversal on that platform).
  it.skipIf(process.platform !== 'win32')(
    'blocks a bare absolute Windows-style path outside the workspace even when the file does not exist',
    async () => {
      const ws = createWorkspace();

      await expect(resolveLocalInputPath('C:\\Users\\someone\\Documents\\secret.docx', ws)).rejects.toThrow(
        'Path traversal blocked'
      );
    }
  );

  it('strips an @ prefix before resolving', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    await expect(resolveLocalInputPath('@test.png', ws)).resolves.toBe(imgPath);
  });

  it.skipIf(!symlinkSupported)('blocks a symlink inside the workspace that points outside it', async () => {
    const ws = createWorkspace();
    const outsideDir = createWorkspace();
    const secretImg = createImageFile(outsideDir, 'secret.png');
    symlinkSync(secretImg, join(ws, 'linked.png'));

    await expect(resolveLocalInputPath('linked.png', ws)).rejects.toThrow('Path traversal blocked');
  });
});

describe('resolveLocalInputPathAllowingTemp (persistReferenceInputs rescue path only)', () => {
  it('still resolves a path within the workspace', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    await expect(resolveLocalInputPathAllowingTemp('test.png', ws)).resolves.toBe(imgPath);
  });

  it('allows an absolute path under the OS temp directory (the uploaded-reference staging area)', async () => {
    const ws = createWorkspace();
    // createWorkspace() itself creates its dirs under os.tmpdir(), so this
    // doubles as "a file staged in temp, not yet copied into the workspace".
    const staged = createWorkspace();
    const stagedImg = createImageFile(staged, 'upload.png');

    await expect(resolveLocalInputPathAllowingTemp(stagedImg, ws)).resolves.toBe(stagedImg);
  });

  // Same platform caveat as above: `C:\...` is only absolute on Windows.
  it.skipIf(process.platform !== 'win32')(
    'still blocks an absolute path outside both the workspace and temp',
    async () => {
      const ws = createWorkspace();

      await expect(resolveLocalInputPathAllowingTemp('C:\\Users\\someone\\Documents\\secret.docx', ws)).rejects.toThrow(
        'Path traversal blocked'
      );
    }
  );
});

describe('processImageUri (Form B / chat multimodal — actually-wired code path)', () => {
  it('returns image_url for an HTTP URL without touching the filesystem', async () => {
    const result = await processImageUri('https://example.com/photo.png', '/nonexistent');

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/photo.png', detail: 'auto' },
    });
  });

  it('resolves and base64-encodes an image inside the workspace', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'test.png');

    const result = await processImageUri('test.png', ws);

    expect(result?.type).toBe('image_url');
    expect(result?.image_url.url).toContain('base64');
  });

  it('blocks ../ traversal instead of reading the escaped file', async () => {
    const ws = createWorkspace();
    const outside = createWorkspace();
    createImageFile(outside, 'secret.png');

    await expect(processImageUri(`../${join(outside, 'secret.png').slice(ws.length + 1)}`, ws)).rejects.toThrow();
  });

  it('blocks an absolute path outside the workspace', async () => {
    const ws = createWorkspace();
    const outside = createWorkspace();
    const secret = createImageFile(outside, 'secret.png');

    await expect(processImageUri(secret, ws)).rejects.toThrow('Path traversal blocked');
  });
});

describe('isWithin', () => {
  it('treats the root itself as within', () => {
    expect(isWithin('/a/b', '/a/b')).toBe(true);
  });

  it('treats a child path as within', () => {
    expect(isWithin('/a/b', '/a/b/c')).toBe(true);
  });

  it('rejects a sibling path', () => {
    expect(isWithin('/a/b', '/a/c')).toBe(false);
  });

  it('rejects the parent of the root', () => {
    expect(isWithin('/a/b', '/a')).toBe(false);
  });
});
