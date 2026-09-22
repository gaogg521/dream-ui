/**
 * Copyright 2026 One Work
 */

/**
 * Local storage for the login page's "remember me" credentials.
 *
 * The password is encrypted with Electron's OS-backed `safeStorage`
 * (`credential.encrypt`/`credential.decrypt` IPC, see
 * `@process/bridge/credentialBridge`) before it ever reaches `localStorage`.
 * Username is encrypted the same way for symmetry — it isn't itself sensitive,
 * but storing it un-tagged would make it impossible to tell an already-migrated
 * entry apart from a legacy one without a second marker.
 *
 * `safeStorage` is a main-process-only API, so it's unavailable in the WebUI
 * target (no Electron main process behind it) and, rarely, on some desktop
 * systems (e.g. Linux without a compatible secret-service backend). On either,
 * "remember me" degrades to "don't persist" rather than falling back to a
 * weaker, reversible encoding — that would just reintroduce the vulnerability
 * this replaces.
 *
 * Migration: entries written by the previous `btoa` + reversed-string
 * "obfuscation" have no {@link ENCRYPTED_PREFIX}. `loadRememberedCredentials`
 * detects that, decodes them with the legacy codec (kept ONLY for this), and
 * transparently re-saves them under the new encrypted format — the user is
 * never asked to log in again just because of this upgrade.
 */

import { ipcBridge } from '@/common';
import { isNativeDialogAvailable, type CredentialCryptoResult } from '@/common/adapter/ipcBridge';

const REMEMBER_ME_KEY = 'rememberMe';
const REMEMBERED_USERNAME_KEY = 'rememberedUsername';
const REMEMBERED_PASSWORD_KEY = 'rememberedPassword';

/** Tags a value as already using the new safeStorage-backed format. */
const ENCRYPTED_PREFIX = 'enc1:';

export type RememberedCredentials = { username: string; password: string };

/**
 * Legacy (pre-safeStorage) codec. Kept ONLY to decode old `localStorage`
 * values during one-time migration — never used to write new data.
 */
function legacyDeobfuscate(text: string): string {
  try {
    const reversed = text.split('').toReversed().join('');
    return decodeURIComponent(atob(reversed));
  } catch {
    return '';
  }
}

/** Whether OS-backed encryption is available, so "remember me" can safely persist a password. */
export async function isRememberPasswordSupported(): Promise<boolean> {
  // Electron-only: on WebUI there's no main process behind this channel, and
  // invoking it would hang rather than reject (no provider ever answers it).
  if (!isNativeDialogAvailable()) return false;
  try {
    return await ipcBridge.credential.isAvailable.invoke();
  } catch {
    return false;
  }
}

async function encryptValue(plainText: string): Promise<string | null> {
  try {
    const result: CredentialCryptoResult = await ipcBridge.credential.encrypt.invoke({ plainText });
    return result.success ? `${ENCRYPTED_PREFIX}${result.data.value}` : null;
  } catch {
    return null;
  }
}

async function decryptValue(stored: string): Promise<string | null> {
  try {
    const cipherText = stored.slice(ENCRYPTED_PREFIX.length);
    const result: CredentialCryptoResult = await ipcBridge.credential.decrypt.invoke({ cipherText });
    return result.success ? result.data.value : null;
  } catch {
    return null;
  }
}

/** Clears any remembered login state (the "remember me" flag and both fields). */
export function clearRememberedCredentials(): void {
  localStorage.removeItem(REMEMBER_ME_KEY);
  localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
}

/**
 * Persists remember-me credentials using OS-backed encryption.
 *
 * Returns `false` (and writes nothing — any previously-remembered entry is
 * cleared) when encryption isn't available on this device. Callers should
 * treat that as "remember password isn't supported here", not fall back to a
 * weaker storage format.
 */
export async function saveRememberedCredentials({ username, password }: RememberedCredentials): Promise<boolean> {
  const [encryptedUsername, encryptedPassword] = await Promise.all([encryptValue(username), encryptValue(password)]);

  if (encryptedUsername === null || encryptedPassword === null) {
    clearRememberedCredentials();
    return false;
  }

  localStorage.setItem(REMEMBER_ME_KEY, 'true');
  localStorage.setItem(REMEMBERED_USERNAME_KEY, encryptedUsername);
  localStorage.setItem(REMEMBERED_PASSWORD_KEY, encryptedPassword);
  return true;
}

/**
 * Reads remembered login credentials, transparently migrating a legacy
 * (pre-safeStorage) entry to the new encrypted format as a side effect.
 *
 * Returns `null` when "remember me" isn't on, or when nothing usable could be
 * recovered — a legacy entry this device currently cannot re-encrypt (no
 * safeStorage available right now) is still decoded once for this read, but
 * is then cleared rather than left behind in its old, reversible form.
 */
export async function loadRememberedCredentials(): Promise<RememberedCredentials | null> {
  if (localStorage.getItem(REMEMBER_ME_KEY) !== 'true') return null;

  const rawUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY) ?? '';
  const rawPassword = localStorage.getItem(REMEMBERED_PASSWORD_KEY) ?? '';
  if (!rawUsername && !rawPassword) return null;

  const isLegacy = !rawUsername.startsWith(ENCRYPTED_PREFIX) && !rawPassword.startsWith(ENCRYPTED_PREFIX);

  if (!isLegacy) {
    const [username, password] = await Promise.all([
      rawUsername ? decryptValue(rawUsername) : '',
      rawPassword ? decryptValue(rawPassword) : '',
    ]);
    if (username === null || password === null) {
      // Can't decrypt with this device's current safeStorage state (OS
      // keychain unavailable, or these bytes were encrypted under a
      // different OS user account). No legacy fallback applies to an
      // already-migrated entry — clear it rather than keep something unreadable.
      clearRememberedCredentials();
      return null;
    }
    return { username, password };
  }

  const credentials: RememberedCredentials = {
    username: rawUsername ? legacyDeobfuscate(rawUsername) : '',
    password: rawPassword ? legacyDeobfuscate(rawPassword) : '',
  };

  const migrated = await saveRememberedCredentials(credentials);
  if (!migrated) {
    // This device can't do OS-backed encryption right now (e.g. WebUI, or a
    // desktop system without a usable safeStorage backend). Keeping the old
    // reversible encoding around would defeat the point of the migration, so
    // it's dropped instead — the user just needs to check "remember me"
    // again next time, on a device that can actually protect it.
    clearRememberedCredentials();
  }

  return credentials;
}
