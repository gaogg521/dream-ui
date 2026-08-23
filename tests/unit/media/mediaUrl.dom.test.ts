/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which URL the renderer hands a media element.
 *
 * The WebUI runs this same bundle in a browser, where `one-media://` — an
 * Electron protocol — does not resolve, so every generated image and video was
 * a broken element there. The route itself is verified against a live server;
 * this covers the other half of the chain: that the renderer *chooses* it.
 *
 * Host detection keys off `window.__backendPort`, which the Electron preload
 * sets and a browser never has.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const setHost = (host: 'electron' | 'browser') => {
  if (host === 'electron') (window as unknown as { __backendPort?: number }).__backendPort = 12345;
  else delete (window as unknown as { __backendPort?: number }).__backendPort;
};

afterEach(() => {
  delete (window as unknown as { __backendPort?: number }).__backendPort;
  vi.resetModules();
});

const loadBuildMediaUrl = async () => (await import('@/common/media/mediaUrl')).buildMediaUrl;

describe('buildMediaUrl', () => {
  it('uses the Electron protocol inside the desktop window', async () => {
    setHost('electron');
    const buildMediaUrl = await loadBuildMediaUrl();
    expect(buildMediaUrl('D:\\ws\\a.png')).toBe('one-media://local/?path=D%3A%5Cws%5Ca.png');
  });

  it('uses the HTTP route in a browser', async () => {
    setHost('browser');
    const buildMediaUrl = await loadBuildMediaUrl();
    expect(buildMediaUrl('D:\\ws\\a.png')).toBe('/media/file?path=D%3A%5Cws%5Ca.png');
  });

  /**
   * Relative on purpose: the WebUI is reached over localhost, a LAN address, or
   * a remote server, and the media must come from whichever origin served the
   * page. An absolute URL would work for exactly one of those.
   */
  it('keeps the browser URL relative to the serving origin', async () => {
    setHost('browser');
    const buildMediaUrl = await loadBuildMediaUrl();
    const url = buildMediaUrl('/home/u/ws/a.mp4');
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  /**
   * Windows paths carry drive letters and backslashes; both hosts must encode
   * them rather than let them be parsed as URL structure.
   */
  it('encodes the path on both hosts', async () => {
    for (const host of ['electron', 'browser'] as const) {
      vi.resetModules();
      setHost(host);
      const buildMediaUrl = await loadBuildMediaUrl();
      const url = buildMediaUrl('D:\\ws\\a b&c.png');
      expect(url).toContain('a%20b%26c.png');
      expect(url).not.toContain('\\');
    }
  });
});
