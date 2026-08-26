/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A local image or video mentioned in assistant prose previews inline.
 *
 * Separate from `markdownLocalFileLink.dom.test.tsx` because that file replaces
 * `@arco-design/web-react` wholesale with a three-component stub; the preview
 * renders through Arco's real `Image`, so asserting the media URL there would
 * only be asserting the stub. Arco is left real here for the same reason
 * `GeneratedMediaView.dom.test.tsx` leaves it real.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import MarkdownView from '@/renderer/components/Markdown';

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock('@/renderer/utils/chat/latexDelimiters', () => ({
  convertLatexDelimiters: (text: string) => text,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

describe('MarkdownView local media preview', () => {
  /**
   * Pins the desktop branch of `buildMediaUrl`. jsdom has no `__backendPort`, so
   * without this every URL assertion would be checking the WebUI host instead.
   */
  beforeEach(() => {
    (window as unknown as { __backendPort?: number }).__backendPort = 12345;
  });

  afterEach(() => {
    delete (window as unknown as { __backendPort?: number }).__backendPort;
    cleanup();
  });

  it('previews an image mentioned in prose instead of leaving only its file name', () => {
    const { container } = render(<MarkdownView>{'[img-1.png](D:/ws/outputs/img-1.png)'}</MarkdownView>);

    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^one-media:\/\/local\/\?path=/);
    expect(decodeURIComponent(img?.getAttribute('src') || '')).toContain('D:/ws/outputs/img-1.png');
  });

  it('plays a video mentioned in prose', () => {
    const { container } = render(<MarkdownView>{'[clip.mp4](D:/ws/outputs/clip.mp4)'}</MarkdownView>);

    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toMatch(/^one-media:\/\/local\/\?path=/);
  });

  it('keeps the chip alongside the preview so the path stays copyable', () => {
    const { container } = render(<MarkdownView>{'[img-1.png](D:/ws/outputs/img-1.png)'}</MarkdownView>);

    expect(container.querySelector('[data-local-file-path]')?.getAttribute('data-local-file-path')).toBe(
      'D:/ws/outputs/img-1.png'
    );
  });

  it('does not preview a non-media file', () => {
    const { container } = render(<MarkdownView>{'[notes.log](D:/ws/notes.log)'}</MarkdownView>);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('video')).toBeNull();
  });

  /**
   * `foo.png:12` is someone pointing at a line in a file, not asking to look at
   * a picture — previewing it would be noise on every such reference.
   */
  it('does not preview an image path that carries a line reference', () => {
    const { container } = render(<MarkdownView>{'[img-1.png](D:/ws/outputs/img-1.png:12)'}</MarkdownView>);

    expect(container.querySelector('img')).toBeNull();
  });
});
