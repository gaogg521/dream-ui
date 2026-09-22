/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the login page's remember-me credential storage
 * (renderer/pages/login/utils/credentialStorage.ts).
 *
 * Covers the two things the security fix hinges on:
 *  - a legacy (pre-safeStorage, btoa+reversed) entry is silently migrated to
 *    the new encrypted format on read, so an upgrade never forces a re-login;
 *  - encryption unavailability (WebUI, or a desktop system without a usable
 *    safeStorage backend) degrades to "don't persist the password" instead of
 *    falling back to the old reversible encoding.
 *
 * `ipcBridge.credential.*` is mocked with a tiny fake "OS keychain" — the
 * real safeStorage round trip is covered separately by
 * tests/unit/credential/credentialBridge.test.ts (main-process side).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const credentialMock = vi.hoisted(() => {
  const state = { available: true, nativeDialogAvailable: true };

  const encrypt = vi.fn(async ({ plainText }: { plainText: string }) => {
    if (!state.available) return { success: false as const, msg: 'unavailable' };
    return { success: true as const, data: { value: `CIPHER(${plainText})` } };
  });

  const decrypt = vi.fn(async ({ cipherText }: { cipherText: string }) => {
    if (!state.available) return { success: false as const, msg: 'unavailable' };
    const match = /^CIPHER\((.*)\)$/.exec(cipherText);
    if (!match) return { success: false as const, msg: 'bad ciphertext' };
    return { success: true as const, data: { value: match[1] } };
  });

  const isAvailable = vi.fn(async () => state.available);

  return { state, encrypt, decrypt, isAvailable };
});

vi.mock('@/common/adapter/ipcBridge', () => ({
  credential: {
    isAvailable: { invoke: credentialMock.isAvailable },
    encrypt: { invoke: credentialMock.encrypt },
    decrypt: { invoke: credentialMock.decrypt },
  },
  isNativeDialogAvailable: () => credentialMock.state.nativeDialogAvailable,
}));

vi.mock('@/common', async () => {
  const bridge = await import('@/common/adapter/ipcBridge');
  return { ipcBridge: bridge };
});

import {
  clearRememberedCredentials,
  isRememberPasswordSupported,
  loadRememberedCredentials,
  saveRememberedCredentials,
} from '@/renderer/pages/login/utils/credentialStorage';

/** The exact legacy codec `login/index.tsx` used to write with, pre-fix. */
function legacyObfuscate(text: string): string {
  const encoded = btoa(encodeURIComponent(text));
  return encoded.split('').toReversed().join('');
}

beforeEach(() => {
  localStorage.clear();
  credentialMock.state.available = true;
  credentialMock.state.nativeDialogAvailable = true;
  vi.clearAllMocks();
});

describe('loadRememberedCredentials', () => {
  it('returns null when remember-me is not enabled', async () => {
    await expect(loadRememberedCredentials()).resolves.toBeNull();
  });

  it('migrates a legacy (pre-safeStorage) entry to the new encrypted format on read', async () => {
    localStorage.setItem('rememberMe', 'true');
    localStorage.setItem('rememberedUsername', legacyObfuscate('alice'));
    localStorage.setItem('rememberedPassword', legacyObfuscate('hunter2'));

    const result = await loadRememberedCredentials();
    expect(result).toEqual({ username: 'alice', password: 'hunter2' });

    // The legacy (reversible) value must be gone, replaced by the new format.
    const storedUsername = localStorage.getItem('rememberedUsername');
    const storedPassword = localStorage.getItem('rememberedPassword');
    expect(storedUsername).toMatch(/^enc1:/);
    expect(storedPassword).toMatch(/^enc1:/);
    expect(storedUsername).not.toBe(legacyObfuscate('alice'));
    expect(storedPassword).not.toBe(legacyObfuscate('hunter2'));

    // A second read must go through decrypt, never touching the legacy codec again.
    credentialMock.decrypt.mockClear();
    const secondResult = await loadRememberedCredentials();
    expect(secondResult).toEqual({ username: 'alice', password: 'hunter2' });
    expect(credentialMock.decrypt).toHaveBeenCalled();
  });

  it('drops a legacy entry rather than leaving it in the old reversible format when encryption is unavailable', async () => {
    localStorage.setItem('rememberMe', 'true');
    localStorage.setItem('rememberedUsername', legacyObfuscate('carol'));
    localStorage.setItem('rememberedPassword', legacyObfuscate('legacyPw'));
    credentialMock.state.available = false;

    // Still decoded once so this login isn't interrupted...
    const result = await loadRememberedCredentials();
    expect(result).toEqual({ username: 'carol', password: 'legacyPw' });

    // ...but nothing vulnerable is left behind for next time.
    expect(localStorage.getItem('rememberMe')).toBeNull();
    expect(localStorage.getItem('rememberedUsername')).toBeNull();
    expect(localStorage.getItem('rememberedPassword')).toBeNull();
  });

  it('clears an already-encrypted entry that cannot be decrypted on this device', async () => {
    localStorage.setItem('rememberMe', 'true');
    localStorage.setItem('rememberedUsername', 'enc1:garbage');
    localStorage.setItem('rememberedPassword', 'enc1:garbage');

    const result = await loadRememberedCredentials();
    expect(result).toBeNull();
    expect(localStorage.getItem('rememberMe')).toBeNull();
    expect(localStorage.getItem('rememberedUsername')).toBeNull();
  });
});

describe('saveRememberedCredentials / loadRememberedCredentials round trip', () => {
  it('persists and reads back credentials through the safeStorage-backed IPC channel', async () => {
    const persisted = await saveRememberedCredentials({ username: 'bob', password: 'p@ss w0rd' });
    expect(persisted).toBe(true);
    expect(localStorage.getItem('rememberMe')).toBe('true');
    expect(localStorage.getItem('rememberedUsername')).toMatch(/^enc1:/);

    const loaded = await loadRememberedCredentials();
    expect(loaded).toEqual({ username: 'bob', password: 'p@ss w0rd' });
  });

  it('does not persist and clears any previous entry when encryption is unavailable', async () => {
    localStorage.setItem('rememberMe', 'true');
    localStorage.setItem('rememberedUsername', 'stale-value');
    credentialMock.state.available = false;

    const persisted = await saveRememberedCredentials({ username: 'dave', password: 'pw' });
    expect(persisted).toBe(false);
    expect(localStorage.getItem('rememberMe')).toBeNull();
    expect(localStorage.getItem('rememberedUsername')).toBeNull();
  });
});

describe('isRememberPasswordSupported', () => {
  it('is unsupported off Electron (e.g. WebUI) without calling the IPC channel', async () => {
    credentialMock.state.nativeDialogAvailable = false;
    await expect(isRememberPasswordSupported()).resolves.toBe(false);
    expect(credentialMock.isAvailable).not.toHaveBeenCalled();
  });

  it('reflects safeStorage availability on Electron', async () => {
    credentialMock.state.available = true;
    await expect(isRememberPasswordSupported()).resolves.toBe(true);

    credentialMock.state.available = false;
    await expect(isRememberPasswordSupported()).resolves.toBe(false);
  });
});

describe('clearRememberedCredentials', () => {
  it('removes all three keys', () => {
    localStorage.setItem('rememberMe', 'true');
    localStorage.setItem('rememberedUsername', 'enc1:x');
    localStorage.setItem('rememberedPassword', 'enc1:y');

    clearRememberedCredentials();

    expect(localStorage.getItem('rememberMe')).toBeNull();
    expect(localStorage.getItem('rememberedUsername')).toBeNull();
    expect(localStorage.getItem('rememberedPassword')).toBeNull();
  });
});
