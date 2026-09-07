/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  BRAND_DISPLAY_NAME,
  findImportableLegacyUserDataDir,
  LEGACY_PROD_USERDATA_APP_NAMES,
  LEGACY_USERDATA_IMPORT_DECLINED_MARKER,
  LEGACY_USERDATA_IMPORT_REQUESTED_MARKER,
  migrateAndResolveProdUserDataDir,
  PROD_USERDATA_APP_NAME,
  USERDATA_DATA_SUBDIR,
} from '@/common/platform';

describe('PROD_USERDATA_APP_NAME / brand identity', () => {
  it('userData directory is "One Work" and matches the display name', () => {
    expect(PROD_USERDATA_APP_NAME).toBe('One Work');
    expect(PROD_USERDATA_APP_NAME).toBe(BRAND_DISPLAY_NAME);
  });

  it('keeps "1ONE Code" as a legacy migration source and never "AionUi"', () => {
    expect(LEGACY_PROD_USERDATA_APP_NAMES).toContain('1ONE Code');
    expect(LEGACY_PROD_USERDATA_APP_NAMES).not.toContain('AionUi');
    expect(LEGACY_PROD_USERDATA_APP_NAMES).not.toContain(PROD_USERDATA_APP_NAME);
  });
});

describe('migrateAndResolveProdUserDataDir', () => {
  let root: string;
  const legacyName = '1ONE Code';
  const marker = 'db/conversations.sqlite';

  const seedDir = (name: string) => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.writeFileSync(path.join(dir, marker), `data for ${name}`);
    return dir;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onework-userdata-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('migrates a legacy directory onto the current name, preserving contents', () => {
    seedDir(legacyName);

    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    expect(fs.existsSync(path.join(root, legacyName))).toBe(false);
    expect(fs.readFileSync(path.join(resolved, marker), 'utf8')).toBe(`data for ${legacyName}`);
  });

  it('leaves the legacy directory untouched when the current directory already exists', () => {
    seedDir(legacyName);
    seedDir(PROD_USERDATA_APP_NAME);

    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    expect(fs.existsSync(path.join(root, legacyName))).toBe(true);
    expect(fs.readFileSync(path.join(resolved, marker), 'utf8')).toBe(`data for ${PROD_USERDATA_APP_NAME}`);
  });

  /**
   * The 3.0.1 data-loss regression, in one test.
   *
   * `configureChromium.ts` read the parent directory as
   * `path.dirname(app.getPath('userData'))`, and resolving 'userData' CREATES
   * the directory. So by the time this function ran, an empty "One Work"
   * always existed, the "already exists" branch short-circuited, and the
   * legacy directory holding every conversation, model provider and licence
   * was never moved. Users upgrading from 3.0.0 opened a blank app.
   *
   * An empty target is a stub, not a profile.
   */
  it('migrates even when an empty target directory already exists (3.0.1 regression)', () => {
    seedDir(legacyName);
    fs.mkdirSync(path.join(root, PROD_USERDATA_APP_NAME));

    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    expect(fs.existsSync(path.join(root, legacyName))).toBe(false);
    expect(fs.readFileSync(path.join(resolved, marker), 'utf8')).toBe(`data for ${legacyName}`);
  });

  it('leaves an empty target alone when there is no legacy directory to migrate', () => {
    fs.mkdirSync(path.join(root, PROD_USERDATA_APP_NAME));

    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    expect(fs.existsSync(resolved)).toBe(true);
  });

  /**
   * The stub check must not reach into a target that holds anything at all —
   * a single Chromium file means the profile is in use, and adopting the
   * legacy directory over it would be the mirror-image data loss.
   */
  it('treats a target holding even one file as a real profile', () => {
    seedDir(legacyName);
    fs.mkdirSync(path.join(root, PROD_USERDATA_APP_NAME));
    fs.writeFileSync(path.join(root, PROD_USERDATA_APP_NAME, 'Local State'), '{}');

    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    expect(fs.existsSync(path.join(root, legacyName))).toBe(true);
    expect(fs.existsSync(path.join(resolved, marker))).toBe(false);
  });

  it('returns the target path unchanged on a fresh install (nothing to migrate)', () => {
    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    expect(fs.existsSync(resolved)).toBe(false);
  });

  it('ignores a legacy path that is a file, not a directory', () => {
    fs.writeFileSync(path.join(root, legacyName), 'stray file, not a userData dir');

    const resolved = migrateAndResolveProdUserDataDir(root);

    expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
    // the stray file is left alone
    expect(fs.readFileSync(path.join(root, legacyName), 'utf8')).toBe('stray file, not a userData dir');
  });
});

/**
 * Recovery for people the broken 3.0.1 already stranded: the new profile is a
 * real one, so the migration above correctly refuses it, and a prompt asks
 * instead. "Yes" is a marker file; this is the code that acts on it.
 */
const request = (dir: string) => fs.writeFileSync(path.join(dir, LEGACY_USERDATA_IMPORT_REQUESTED_MARKER), 'x');

describe('requested legacy userData import', () => {
  let root: string;
  const legacyName = '1ONE Code';
  const marker = 'db/conversations.sqlite';

  const seedProfile = (name: string, catalog = 'one-backend.db') => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(dir, USERDATA_DATA_SUBDIR), { recursive: true });
    fs.writeFileSync(path.join(dir, USERDATA_DATA_SUBDIR, catalog), `catalog for ${name}`);
    fs.writeFileSync(path.join(dir, marker), `data for ${name}`);
    return dir;
  };
  const displacedDirs = () => fs.readdirSync(root).filter((n) => n.startsWith(`${PROD_USERDATA_APP_NAME}.superseded-`));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'onework-import-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('findImportableLegacyUserDataDir', () => {
    it('offers a legacy profile that holds a backend catalog', () => {
      const legacy = seedProfile(legacyName);
      const current = seedProfile(PROD_USERDATA_APP_NAME);

      expect(findImportableLegacyUserDataDir(root, current)).toBe(legacy);
    });

    it('offers one holding only the pre-rebrand catalog name', () => {
      const legacy = seedProfile(legacyName, 'aionui-backend.db');
      const current = seedProfile(PROD_USERDATA_APP_NAME);

      expect(findImportableLegacyUserDataDir(root, current)).toBe(legacy);
    });

    it('stays silent when the legacy directory has no backend catalog', () => {
      fs.mkdirSync(path.join(root, legacyName, 'Cache'), { recursive: true });
      const current = seedProfile(PROD_USERDATA_APP_NAME);

      expect(findImportableLegacyUserDataDir(root, current)).toBeNull();
    });

    /**
     * The migration falls back to using the legacy directory in place when the
     * rename fails. Offering to import the directory we are already running
     * from would be a prompt with no meaning behind either answer.
     */
    it('stays silent when the legacy directory IS the current profile', () => {
      const legacy = seedProfile(legacyName);

      expect(findImportableLegacyUserDataDir(root, legacy)).toBeNull();
    });

    it('never asks twice — a declined or already-requested directory is skipped', () => {
      const legacy = seedProfile(legacyName);
      const current = seedProfile(PROD_USERDATA_APP_NAME);

      fs.writeFileSync(path.join(legacy, LEGACY_USERDATA_IMPORT_DECLINED_MARKER), 'x');
      expect(findImportableLegacyUserDataDir(root, current)).toBeNull();

      fs.rmSync(path.join(legacy, LEGACY_USERDATA_IMPORT_DECLINED_MARKER));
      request(legacy);
      expect(findImportableLegacyUserDataDir(root, current)).toBeNull();
    });
  });

  describe('migrateAndResolveProdUserDataDir honouring the request', () => {
    it('swaps the legacy profile in and keeps the displaced one', () => {
      const legacy = seedProfile(legacyName);
      seedProfile(PROD_USERDATA_APP_NAME);
      request(legacy);

      const resolved = migrateAndResolveProdUserDataDir(root);

      expect(resolved).toBe(path.join(root, PROD_USERDATA_APP_NAME));
      expect(fs.readFileSync(path.join(resolved, marker), 'utf8')).toBe(`data for ${legacyName}`);
      expect(fs.existsSync(path.join(root, legacyName))).toBe(false);

      // the blank profile is moved aside, never deleted
      const displaced = displacedDirs();
      expect(displaced).toHaveLength(1);
      expect(fs.readFileSync(path.join(root, displaced[0], marker), 'utf8')).toBe(`data for ${PROD_USERDATA_APP_NAME}`);
    });

    it('clears the request marker so the swap happens exactly once', () => {
      const legacy = seedProfile(legacyName);
      seedProfile(PROD_USERDATA_APP_NAME);
      request(legacy);

      const resolved = migrateAndResolveProdUserDataDir(root);
      expect(fs.existsSync(path.join(resolved, LEGACY_USERDATA_IMPORT_REQUESTED_MARKER))).toBe(false);

      // second boot: nothing left to act on, and the imported profile stands
      expect(migrateAndResolveProdUserDataDir(root)).toBe(resolved);
      expect(displacedDirs()).toHaveLength(1);
      expect(fs.readFileSync(path.join(resolved, marker), 'utf8')).toBe(`data for ${legacyName}`);
    });

    /**
     * Without a marker this is an ordinary boot, and an ordinary boot must
     * never touch a profile that is in use — that is the mirror image of the
     * bug being fixed.
     */
    it('leaves both profiles alone when no import was requested', () => {
      seedProfile(legacyName);
      seedProfile(PROD_USERDATA_APP_NAME);

      const resolved = migrateAndResolveProdUserDataDir(root);

      expect(fs.readFileSync(path.join(resolved, marker), 'utf8')).toBe(`data for ${PROD_USERDATA_APP_NAME}`);
      expect(fs.existsSync(path.join(root, legacyName))).toBe(true);
      expect(displacedDirs()).toHaveLength(0);
    });
  });
});
