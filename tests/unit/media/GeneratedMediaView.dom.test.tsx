/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseGeneratedMediaAssets } from '@/common/media/mediaResultText';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const GeneratedMediaView = (await import('@/renderer/components/media/GeneratedMediaView')).default;

describe('GeneratedMediaView', () => {
  /**
   * These assertions are about the **desktop window**, where `one-media://` is
   * registered. jsdom has no `__backendPort`, so without pinning the host the
   * component takes the browser branch and every URL assertion below would be
   * checking the wrong host. The browser branch has its own coverage in
   * `mediaUrl.dom.test.ts`.
   */
  beforeEach(() => {
    (window as unknown as { __backendPort?: number }).__backendPort = 12345;
  });

  afterEach(() => {
    delete (window as unknown as { __backendPort?: number }).__backendPort;
    cleanup();
  });

  it('renders nothing when there are no assets', () => {
    const { container } = render(<GeneratedMediaView assets={[]} />);
    expect(container.firstChild).toBeNull();
  });

  // The whole point of the multi-image fix: four results must produce four tiles.
  // `/api/fs/image-base64` refuses paths outside a known root (400), so the
  // base64 route could never show a generated thumbnail — images go over the
  // same protocol as video.
  it('serves images over the one-media protocol, not base64', () => {
    const assets = parseGeneratedMediaAssets('Generated image saved to: D:\\ws\\a.png');
    const { container } = render(<GeneratedMediaView assets={assets} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^one-media:\/\/local\/\?path=/);
    expect(decodeURIComponent(img?.getAttribute('src') || '')).toContain('D:\\ws\\a.png');
  });

  it('renders every image from a multi-image result', () => {
    const assets = parseGeneratedMediaAssets(
      ['Generated image saved to: /ws/a.png', 'Generated image saved to: /ws/b.png'].join('\n')
    );
    const { container } = render(<GeneratedMediaView assets={assets} />);
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('plays a video through the one-media protocol, never a file:// url', () => {
    const assets = parseGeneratedMediaAssets('Generated video saved to: D:\\ws\\clip.mp4');
    const { container } = render(<GeneratedMediaView assets={assets} />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    // file:// is blocked by webSecurity in the renderer, and streaming through
    // the protocol is what keeps video bytes off the IPC channel (rule D6).
    expect(video?.getAttribute('src')).toMatch(/^one-media:\/\/local\/\?path=/);
    expect(video?.getAttribute('src')).not.toMatch(/^file:/);
    expect(decodeURIComponent(video?.getAttribute('src') || '')).toContain('D:\\ws\\clip.mp4');
  });

  it('renders images and videos from the same result', () => {
    const assets = parseGeneratedMediaAssets(
      ['Generated image saved to: /ws/a.png', 'Generated video saved to: /ws/c.mp4'].join('\n')
    );
    const { container } = render(<GeneratedMediaView assets={assets} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelectorAll('video')).toHaveLength(1);
  });
});
