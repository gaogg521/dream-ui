/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * The app hands out `dream://` but must keep answering to `aionui://`.
 *
 * Two independent reasons, and dropping either name breaks SSO in a way that
 * shows up as "login worked in the browser and the app never noticed":
 *
 *  1. An aioncore older than the rename maps any scheme it does not recognise
 *     back to `aionui`, and the desktop app pairs with a pinned release — so a
 *     current app asking for `dream` routinely receives an `aionui://` callback.
 *  2. An existing install already has the old association registered with the OS.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: true },
}));

vi.mock('@/common', () => ({ ipcBridge: {} }));

const { ACCEPTED_PROTOCOL_SCHEMES, LEGACY_PROTOCOL_SCHEMES, PROTOCOL_SCHEME, isDeepLinkUrl, parseDeepLinkUrl } =
  await import('@process/utils/deepLink');

describe('deep-link schemes', () => {
  it('hands out the current scheme', () => {
    expect(PROTOCOL_SCHEME).toBe('dream');
  });

  it('still answers to the pre-rebrand scheme', () => {
    expect(ACCEPTED_PROTOCOL_SCHEMES).toContain('aionui');
    expect(LEGACY_PROTOCOL_SCHEMES).toContain('aionui');
  });

  it('parses a callback on the current scheme', () => {
    expect(parseDeepLinkUrl('dream://sso-callback?token=abc')).toEqual({
      action: 'sso-callback',
      params: { token: 'abc' },
    });
  });

  it('parses a callback an older backend sent on the legacy scheme', () => {
    expect(parseDeepLinkUrl('aionui://sso-callback?token=abc')).toEqual({
      action: 'sso-callback',
      params: { token: 'abc' },
    });
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
