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
  LEGACY_PROD_USERDATA_APP_NAMES,
  migrateAndResolveProdUserDataDir,
  PROD_USERDATA_APP_NAME,
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
