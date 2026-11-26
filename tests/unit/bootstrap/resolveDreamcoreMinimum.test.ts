import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveDreamcoreVersion } = require('../../../scripts/resolveDreamcoreVersion.js');
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

it('rejects an old pinned Core while accepting the required version or explicit local builds', () => {
  for (const key of ['DREAM_BACKEND_VERSION', 'DREAM_BACKEND_LOCAL_PATH', 'DREAM_BACKEND_LOCAL_BUNDLE_DIR'])
    vi.stubEnv(key, '');
  const root = mkdtempSync(join(tmpdir(), 'core-pin-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dreamcoreVersion: 'v0.1.106', dreamcoreMinimumVersion: 'v0.1.107' })
  );
  expect(() => resolveDreamcoreVersion(root)).toThrow('does not satisfy');
  vi.stubEnv('DREAM_BACKEND_VERSION', 'v0.1.107');
  expect(resolveDreamcoreVersion(root)).toBe('v0.1.107');
  vi.stubEnv('DREAM_BACKEND_VERSION', 'v0.2.0');
  expect(resolveDreamcoreVersion(root)).toBe('v0.2.0');
  vi.stubEnv('DREAM_BACKEND_VERSION', 'v0.1.106');
  vi.stubEnv('DREAM_BACKEND_LOCAL_PATH', '/explicit/local/core');
  expect(resolveDreamcoreVersion(root)).toBe('v0.1.106');
});
