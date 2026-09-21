/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 *
 * Node-environment tests for credentialBridge — the main-process side of the
 * safeStorage-backed "remember me" encryption used by the login page.
 * Covers the encrypt/decrypt round trip and graceful degradation when
 * `safeStorage.isEncryptionAvailable()` is false.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TransportEmitter = {
  emit: (name: string, data: unknown) => unknown;
};

/**
 * In-process loopback for the `bridge` pub/sub abstraction, mirroring
 * tests/unit/common-platform/bridge.test.ts — lets `ipcBridge.credential.*`
 * providers registered here answer `.invoke()` calls made in the same
 * process, without a real Electron IPC/WebSocket transport.
 */
const wireLoopbackBridge = async () => {
  const { bridge } = await import('@/common/platform/bridge');
  let incoming: TransportEmitter | undefined;
  bridge.adapter({
    emit(name, data) {
      return incoming?.emit(name, data);
    },
    on(emitter) {
      incoming = emitter;
    },
  });
};

let encryptionAvailable = true;

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => encryptionAvailable),
    encryptString: vi.fn((plainText: string) => Buffer.from(`enc(${plainText})`, 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => {
      const raw = buffer.toString('utf8');
      const match = /^enc\((.*)\)$/.exec(raw);
      if (!match) throw new Error('bad ciphertext');
      return match[1];
    }),
  },
}));

beforeEach(async () => {
  vi.resetModules();
  encryptionAvailable = true;
  await wireLoopbackBridge();
  const { initCredentialBridge } = await import('@/process/bridge/credentialBridge');
  initCredentialBridge();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('credentialBridge', () => {
  it('reports encryption as available', async () => {
    const { ipcBridge } = await import('@/common');
    await expect(ipcBridge.credential.isAvailable.invoke()).resolves.toBe(true);
  });

  it('round-trips a password through encrypt then decrypt', async () => {
    const { ipcBridge } = await import('@/common');
    const plainText = 'S3cret! password with 中文 and emoji 🔒';

    const encrypted = await ipcBridge.credential.encrypt.invoke({ plainText });
    expect(encrypted.success).toBe(true);
    if (!encrypted.success) throw new Error('unreachable');
    // The ciphertext must not contain the plaintext verbatim.
    expect(encrypted.data.value).not.toContain(plainText);

    const decrypted = await ipcBridge.credential.decrypt.invoke({ cipherText: encrypted.data.value });
    expect(decrypted.success).toBe(true);
    if (!decrypted.success) throw new Error('unreachable');
    expect(decrypted.data.value).toBe(plainText);
  });

  it('round-trips an empty string', async () => {
    const { ipcBridge } = await import('@/common');
    const encrypted = await ipcBridge.credential.encrypt.invoke({ plainText: '' });
    expect(encrypted.success).toBe(true);
    if (!encrypted.success) throw new Error('unreachable');

    const decrypted = await ipcBridge.credential.decrypt.invoke({ cipherText: encrypted.data.value });
    expect(decrypted.success).toBe(true);
    if (!decrypted.success) throw new Error('unreachable');
    expect(decrypted.data.value).toBe('');
  });

  it('fails encrypt gracefully when safeStorage.isEncryptionAvailable() is false', async () => {
    encryptionAvailable = false;
    const { ipcBridge } = await import('@/common');

    const result = await ipcBridge.credential.encrypt.invoke({ plainText: 'hello' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.msg).toBeTruthy();
  });

  it('fails decrypt gracefully when safeStorage.isEncryptionAvailable() is false', async () => {
    encryptionAvailable = false;
    const { ipcBridge } = await import('@/common');

    const result = await ipcBridge.credential.decrypt.invoke({ cipherText: 'ZG9lc250bWF0dGVy' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.msg).toBeTruthy();
  });

  it('fails decrypt gracefully on corrupted/garbage ciphertext instead of throwing', async () => {
    const { ipcBridge } = await import('@/common');

    const result = await ipcBridge.credential.decrypt.invoke({ cipherText: 'not-valid-ciphertext' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.msg).toBeTruthy();
  });

  it('isAvailable reflects safeStorage.isEncryptionAvailable() being false', async () => {
    encryptionAvailable = false;
    const { ipcBridge } = await import('@/common');
    await expect(ipcBridge.credential.isAvailable.invoke()).resolves.toBe(false);
  });
});
