/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * One Work uses only its current production or development protocol.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: true },
}));

vi.mock('@/common', () => ({ ipcBridge: {} }));

const { ACCEPTED_PROTOCOL_SCHEMES, PROTOCOL_SCHEME, isDeepLinkUrl, parseDeepLinkUrl } =
  await import('@process/utils/deepLink');

describe('deep-link schemes', () => {
  it('hands out the current scheme', () => {
    expect(PROTOCOL_SCHEME).toBe('dream');
  });

  it('registers only the current production scheme', () => {
    expect(ACCEPTED_PROTOCOL_SCHEMES).toEqual(['dream']);
  });

  it('parses a callback on the current scheme', () => {
    expect(parseDeepLinkUrl('dream://sso-callback?token=abc')).toEqual({
      action: 'sso-callback',
      params: { token: 'abc' },
    });
  });

  it('rejects callbacks on retired protocols', () => {
    expect(parseDeepLinkUrl('aionui://sso-callback?token=abc')).toBeNull();
    expect(parseDeepLinkUrl('aionui-dev://sso-callback?token=abc')).toBeNull();
  });

  it('rejects a scheme this build never claimed', () => {
    expect(parseDeepLinkUrl('javascript://sso-callback?token=abc')).toBeNull();
    expect(parseDeepLinkUrl('https://example.com/sso-callback')).toBeNull();
  });

  it('recognises argv entries for every accepted scheme, and nothing else', () => {
    for (const scheme of ACCEPTED_PROTOCOL_SCHEMES) {
      expect(isDeepLinkUrl(`${scheme}://sso-callback`), scheme).toBe(true);
    }
    expect(isDeepLinkUrl('https://example.com')).toBe(false);
    expect(isDeepLinkUrl('--some-electron-flag')).toBe(false);
  });
});
