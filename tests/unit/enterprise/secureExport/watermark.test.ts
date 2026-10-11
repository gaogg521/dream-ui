/**
 * Copyright 2026 One Work
 */

import { describe, expect, it } from 'vitest';
import {
  contentHashPrefix,
  isWatermarkable,
  isWatermarkLine,
  normalizeForHash,
  stampMarkdown,
  watermarkLine,
} from '@/renderer/utils/enterprise/secureExport/watermark';

// Pinned vector shared with dream-core `secure_export.rs::tests::shared_test_vector`.
// The server verifies these marks, so both sides must produce the same bytes.
const VECTOR_KEY = new Uint8Array(32).fill(7);
const VECTOR_SEED = 'AAECAwQFBgcICQoL';
const VECTOR_TS = 1_760_000_000;
const VECTOR_TEXT = '# 标题\r\n\r\nHello world.  \n\n';
const VECTOR_HASH = '89020028383549a1';
const VECTOR_LINE = '<!-- ow:wm1.AAECAwQFBgcICQoL.t3uwow.89020028383549a1.d0d5355d4b0c11fb -->';

describe('watermark format', () => {
  it('matches the server test vector byte for byte', async () => {
    expect(normalizeForHash(VECTOR_TEXT)).toBe('# 标题\n\nHello world.');
    expect(await contentHashPrefix(VECTOR_TEXT)).toBe(VECTOR_HASH);
    expect(await watermarkLine(VECTOR_KEY, VECTOR_SEED, VECTOR_TS, VECTOR_TEXT)).toBe(VECTOR_LINE);
  });

  it('stamps once, keeps the body, and restamping replaces the old mark', async () => {
    const body = '# Plan\n\nShip it.\n';
    const once = await stampMarkdown(body, VECTOR_KEY, VECTOR_SEED, VECTOR_TS);
    expect(once.startsWith('# Plan\n\nShip it.\n\n<!-- ow:wm1.')).toBe(true);
    const twice = await stampMarkdown(once, VECTOR_KEY, VECTOR_SEED, VECTOR_TS + 60);
    expect(twice.split('\n').filter(isWatermarkLine)).toHaveLength(1);
    // The hash ignores the mark itself, so a stamped file still hashes as its body.
    expect(await contentHashPrefix(twice)).toBe(await contentHashPrefix(body));
  });

  it('keeps CRLF files CRLF', async () => {
    const stamped = await stampMarkdown('a\r\nb\r\n', VECTOR_KEY, VECTOR_SEED, VECTOR_TS);
    expect(stamped).toMatch(/^a\r\nb\r\n\r\n<!-- ow:wm1\.[^\r\n]+ -->\r\n$/);
  });

  it('only treats Markdown as watermarkable', () => {
    expect(isWatermarkable('notes.md')).toBe(true);
    expect(isWatermarkable('NOTES.MARKDOWN')).toBe(true);
    expect(isWatermarkable('report.html')).toBe(false);
    expect(isWatermarkable('image.png')).toBe(false);
  });

  it('does not mistake ordinary comments for marks', () => {
    expect(isWatermarkLine('<!-- TODO -->')).toBe(false);
    expect(isWatermarkLine('  <!-- ow:wm1.x.1.2.3 -->  ')).toBe(true);
  });
});
