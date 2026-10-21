import { beforeEach, describe, expect, it } from 'vitest';
import {
  cacheOriginal,
  clearOriginalCache,
  getCachedOriginal,
  originalCacheKey,
} from '@/renderer/pages/knowledge/original/originalCache';

const blobOf = (size: number) => new Blob([new Uint8Array(size)]);

describe('original file cache', () => {
  beforeEach(clearOriginalCache);

  it('keys on the stored source, so a replaced original is never served from the old entry', () => {
    const first = blobOf(10);
    cacheOriginal(originalCacheKey('doc', 'rag-source:a'), first);
    expect(getCachedOriginal(originalCacheKey('doc', 'rag-source:a'))).toBe(first);
    expect(getCachedOriginal(originalCacheKey('doc', 'rag-source:b'))).toBeUndefined();
  });

  it('evicts the least recently used entries once the budget is exceeded', () => {
    const mib = 1024 * 1024;
    cacheOriginal('a', blobOf(100 * mib));
    cacheOriginal('b', blobOf(100 * mib));
    getCachedOriginal('a');
    cacheOriginal('c', blobOf(100 * mib));
    expect(getCachedOriginal('b')).toBeUndefined();
    expect(getCachedOriginal('a')).toBeDefined();
    expect(getCachedOriginal('c')).toBeDefined();
  });

  it('does not cache an empty blob', () => {
    cacheOriginal('empty', blobOf(0));
    expect(getCachedOriginal('empty')).toBeUndefined();
  });
});
