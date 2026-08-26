/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseGeneratedMediaAssets } from '@/common/media/mediaResultText';
import { buildMediaUrl } from '@/common/media/mediaUrl';

describe('parseGeneratedMediaAssets', () => {
  it('picks up every asset line from a multi-image result', () => {
    const text = [
      'Here are your images.',
      '',
      'Generated image saved to: D:\\ws\\img-1.png',
      'Generated image saved to: D:\\ws\\img-2.png',
      'Generated image saved to: D:\\ws\\img-3.png',
    ].join('\n');

    const assets = parseGeneratedMediaAssets(text);
    expect(assets).toHaveLength(3);
    expect(assets.every((a) => a.kind === 'image')).toBe(true);
    expect(assets[1].fileName).toBe('img-2.png');
  });

  it('recognizes videos', () => {
    const assets = parseGeneratedMediaAssets('Generated video saved to: /home/u/out/clip.mp4');
    expect(assets).toEqual([{ kind: 'video', filePath: '/home/u/out/clip.mp4', fileName: 'clip.mp4' }]);
  });

  // The extension decides how it renders, so it must win over the announced word.
  it('trusts the extension over the announced kind', () => {
    const assets = parseGeneratedMediaAssets('Generated image saved to: /tmp/actually.mp4');
    expect(assets[0].kind).toBe('video');
  });

  it('collapses duplicates so one asset renders one tile', () => {
    const text = 'Generated image saved to: /tmp/a.png\nGenerated image saved to: /tmp/a.png';
    expect(parseGeneratedMediaAssets(text)).toHaveLength(1);
  });

  it('ignores paths with no renderable extension', () => {
    expect(parseGeneratedMediaAssets('Generated image saved to: /tmp/report.txt')).toEqual([]);
    expect(parseGeneratedMediaAssets('Generated image saved to:')).toEqual([]);
  });

  it('ignores prose that merely mentions a file', () => {
    expect(parseGeneratedMediaAssets('I wrote the picture to /tmp/a.png for you.')).toEqual([]);
  });

  it('tolerates empty input', () => {
    expect(parseGeneratedMediaAssets('')).toEqual([]);
  });
});

describe('buildMediaUrl', () => {
  // Windows paths must survive: `one-media://D:\x\y.mp4` would parse the drive
  // letter as a host, which is why the path travels as a query parameter.
  it('round-trips a Windows path', () => {
    const url = buildMediaUrl('D:\\ws\\out\\clip 1.mp4');
    expect(new URL(url).searchParams.get('path')).toBe('D:\\ws\\out\\clip 1.mp4');
  });

  it('round-trips a POSIX path', () => {
    const url = buildMediaUrl('/home/u/a b/c.png');
    expect(new URL(url).searchParams.get('path')).toBe('/home/u/a b/c.png');
  });
});
