/**
 * Copyright 2026 One Work
 */

/**
 * Credential Bridge — OS-backed encryption for locally remembered login
 * credentials ("remember me" on the login page).
 *
 * The renderer cannot call Electron's `safeStorage` directly — it's a
 * main-process-only API — so this proxies `encryptString`/`decryptString`
 * through IPC. `safeStorage` uses the OS credential store (DPAPI on Windows,
 * Keychain on macOS, libsecret on Linux), so the ciphertext it produces
 * cannot be reversed by anyone who only has what ends up in the renderer's
 * `localStorage` — unlike the previous `btoa` + reversed-string "obfuscation"
 * it replaces.
 *
 * `safeStorage.encryptString`/`decryptString` work with Buffers, but the IPC
 * bridge here is JSON-only (both the Electron IPC transport and the WebUI
 * WebSocket transport round-trip through `JSON.stringify`), so ciphertext is
 * base64-encoded for transport and storage.
 *
 * `safeStorage.isEncryptionAvailable()` can be false on a small number of
 * systems (e.g. Linux without a compatible secret-service backend). Callers
 * must check `isAvailable` (or handle a `{ success: false }` result) and
 * degrade gracefully — never assume encryption always succeeds.
 */

import { safeStorage } from 'electron';
import { ipcBridge } from '@/common';
import type { CredentialCryptoResult } from '@/common/adapter/ipcBridge';

function isSafeStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    // Never let a platform quirk here take down the login page.
    return false;
  }
}

export function initCredentialBridge(): void {
  ipcBridge.credential.isAvailable.provider(() => isSafeStorageAvailable());

  ipcBridge.credential.encrypt.provider(({ plainText }): CredentialCryptoResult => {
    try {
      if (!isSafeStorageAvailable()) {
        return { success: false, msg: 'Encryption is not available on this system.' };
      }
      const value = safeStorage.encryptString(plainText).toString('base64');
      return { success: true, data: { value } };
    } catch (e) {
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcBridge.credential.decrypt.provider(({ cipherText }): CredentialCryptoResult => {
    try {
      if (!isSafeStorageAvailable()) {
        return { success: false, msg: 'Encryption is not available on this system.' };
      }
      const value = safeStorage.decryptString(Buffer.from(cipherText, 'base64'));
      return { success: true, data: { value } };
    } catch (e) {
      // Wrong key (different machine/OS-account), corrupted data, or an
      // unencrypted/garbage base64 blob — all surface as a decrypt failure,
      // never a crash.
      return { success: false, msg: e instanceof Error ? e.message : String(e) };
    }
  });
}
