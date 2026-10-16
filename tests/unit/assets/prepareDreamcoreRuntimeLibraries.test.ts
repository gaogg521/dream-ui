import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { copyRuntimeLibraries } = require('../../../packages/shared-scripts/src/prepare-dreamcore');

const workdir = () => mkdtempSync(join(tmpdir(), 'one-runtime-libs-'));

describe('prepare-dreamcore runtime libraries', () => {
  it('carries the ONNX Runtime library and the VC++ runtime beside the binary into the bundle', () => {
    const tmp = workdir();
    try {
      const extracted = join(tmp, 'extracted');
      const target = join(tmp, 'bundle');
      mkdirSync(extracted, { recursive: true });
      mkdirSync(target, { recursive: true });
      for (const name of [
        'dreamcore.exe',
        'onnxruntime.dll',
        'vcruntime140.dll',
        'vcruntime140_1.dll',
        'msvcp140.dll',
      ]) {
        writeFileSync(join(extracted, name), name);
      }
      writeFileSync(join(extracted, 'README.txt'), 'not a runtime library');

      const copied = copyRuntimeLibraries(join(extracted, 'dreamcore.exe'), target);

      expect([...copied].sort()).toEqual(['msvcp140.dll', 'onnxruntime.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']);
      expect(readFileSync(join(target, 'onnxruntime.dll'), 'utf8')).toBe('onnxruntime.dll');
      // Only the runtime libraries travel; the binary and anything else stay to the caller.
      expect(existsSync(join(target, 'dreamcore.exe'))).toBe(false);
      expect(existsSync(join(target, 'README.txt'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('handles the Unix names, and an archive with no library (an older release)', () => {
    const tmp = workdir();
    try {
      const extracted = join(tmp, 'extracted');
      const target = join(tmp, 'bundle');
      mkdirSync(extracted, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(join(extracted, 'dreamcore'), '');
      expect(copyRuntimeLibraries(join(extracted, 'dreamcore'), target)).toEqual([]);

      writeFileSync(join(extracted, 'libonnxruntime.so'), 'so');
      writeFileSync(join(extracted, 'libonnxruntime.dylib'), 'dylib');
      expect([...copyRuntimeLibraries(join(extracted, 'dreamcore'), target)].sort()).toEqual([
        'libonnxruntime.dylib',
        'libonnxruntime.so',
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('finds the library a cargo build leaves in target/onnxruntime, next to target/release', () => {
    const tmp = workdir();
    try {
      const release = join(tmp, 'target', 'release');
      const ort = join(tmp, 'target', 'onnxruntime');
      const bundle = join(tmp, 'bundle');
      mkdirSync(release, { recursive: true });
      mkdirSync(ort, { recursive: true });
      mkdirSync(bundle, { recursive: true });
      writeFileSync(join(release, 'dreamcore.exe'), '');
      writeFileSync(join(ort, 'onnxruntime.dll'), 'dll');

      expect(copyRuntimeLibraries(join(release, 'dreamcore.exe'), bundle)).toEqual(['onnxruntime.dll']);
      expect(existsSync(join(bundle, 'onnxruntime.dll'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
