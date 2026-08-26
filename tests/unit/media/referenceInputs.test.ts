/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The send box hands every attached path to the adapters as `inputUris`, and
 * they all treat those as images. A PDF attached in media mode therefore came
 * back as an opaque provider-side parse error naming nothing.
 */

import { describe, expect, it } from 'vitest';
import { baseName, isReferenceImage, splitReferenceInputs } from '@/common/media/referenceInputs';

describe('isReferenceImage', () => {
  it('accepts the image extensions the adapters can read', () => {
    for (const path of ['a.png', 'a.JPG', 'x/y/z.jpeg', 'D:\\ws\\a.webp', 'a.gif', 'a.bmp']) {
      expect(isReferenceImage(path)).toBe(true);
    }
  });

  it('rejects documents, which is the whole point', () => {
    for (const path of ['report.pdf', 'notes.md', 'a.txt', 'sheet.xlsx', 'archive.zip', 'noext']) {
      expect(isReferenceImage(path)).toBe(false);
    }
  });

  // A URL's extension hides behind the query string, so a naive endsWith would
  // reject a perfectly good remote image.
  it('sees through a query string on a URL', () => {
    expect(isReferenceImage('https://cdn.example.com/a.png?w=100&sig=abc')).toBe(true);
    expect(isReferenceImage('https://cdn.example.com/doc.pdf?x=1')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isReferenceImage('')).toBe(false);
  });
});

describe('splitReferenceInputs', () => {
  it('keeps images and reports what it left out', () => {
    const { images, rejected } = splitReferenceInputs(['a.png', 'b.pdf', 'c.jpg', 'd.md']);
    expect(images).toEqual(['a.png', 'c.jpg']);
    expect(rejected).toEqual(['b.pdf', 'd.md']);
  });

  it('returns empty lists for no input', () => {
    expect(splitReferenceInputs([])).toEqual({ images: [], rejected: [] });
  });
});

describe('baseName', () => {
  it('names the file the user recognizes, on either separator', () => {
    expect(baseName('D:\\ws\\deep\\report.pdf')).toBe('report.pdf');
    expect(baseName('/home/u/report.pdf')).toBe('report.pdf');
    expect(baseName('report.pdf')).toBe('report.pdf');
  });
});
