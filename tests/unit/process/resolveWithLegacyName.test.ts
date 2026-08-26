/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Storage file names were rebranded by aliasing, not by moving files.
 *
 * These names ARE the user's data — `.aionui-env` holds their custom
 * cache/work/log directories, `aionui-chat.txt` their conversation index. A
 * rename that pointed at a name nothing on disk uses would not fail loudly: the
 * JSON store would come up empty and write a fresh file, and the user would find
 * their settings and history apparently gone. So the resolver prefers the
 * current name and falls back to the pre-rebrand one when that is what exists.
 *
 * Mirrors `data_paths::resolve_with_legacy` on the backend side; the two must
 * keep the same precedence or an install can end up split across both names.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveWithLegacyName } from '@process/utils';

const CURRENT = 'one-chat.txt';
const LEGACY = 'aionui-chat.txt';

describe('resolveWithLegacyName', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'legacy-name-'));
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('keeps using a pre-rebrand file that already exists', () => {
    fs.writeFileSync(path.join(dir, LEGACY), '{"existing":true}');

    expect(resolveWithLegacyName(dir, CURRENT, LEGACY)).toBe(path.join(dir, LEGACY));
  });

  it('uses the current name on a fresh install', () => {
    expect(resolveWithLegacyName(dir, CURRENT, LEGACY)).toBe(path.join(dir, CURRENT));
  });

  it('prefers the current name when both exist', () => {
    fs.writeFileSync(path.join(dir, CURRENT), '{}');
    fs.writeFileSync(path.join(dir, LEGACY), '{}');

    expect(resolveWithLegacyName(dir, CURRENT, LEGACY)).toBe(path.join(dir, CURRENT));
  });

  it('resolves a legacy directory the same way it resolves a legacy file', () => {
    fs.mkdirSync(path.join(dir, 'aionui-chat-history'));

    expect(resolveWithLegacyName(dir, 'one-chat-history', 'aionui-chat-history')).toBe(
      path.join(dir, 'aionui-chat-history')
    );
  });

  it('does not invent a path outside the parent directory', () => {
    const resolved = resolveWithLegacyName(dir, CURRENT, LEGACY);

    expect(path.dirname(resolved)).toBe(dir);
  });
});
