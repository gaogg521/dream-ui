/**
 * Copyright 2026 One Work
 */

import { describe, expect, it } from 'vitest';
import {
  PackageFormatError,
  buildPayload,
  openPackage,
  randomBytes,
  readPackageHeader,
  sealPackage,
} from '@/renderer/utils/enterprise/secureExport/packageFormat';

const enc = (s: string) => new TextEncoder().encode(s);
const header = {
  packageId: 'pkg-1',
  serverOrigin: 'https://ow.example.com',
  enterpriseId: 'ent-1',
  createdAt: 1_760_000_000_000,
};

async function seal(dek: Uint8Array<ArrayBuffer>) {
  const { payload } = await buildPayload(
    [
      { name: 'a.md', bytes: enc('# A\n') },
      { name: 'pic.png', bytes: new Uint8Array([0, 1, 2, 255]) },
    ],
    'Alice',
    header.createdAt
  );
  return sealPackage(payload, dek, header);
}

describe('.owenc package format', () => {
  it('round-trips several files with the right key', async () => {
    const dek = randomBytes(32);
    const sealed = await seal(dek);
    expect(readPackageHeader(sealed).header).toMatchObject({ ...header, v: 1, alg: 'A256GCM' });
    const opened = await openPackage(sealed, dek);
    expect(opened.files.map((f) => f.name)).toEqual(['a.md', 'pic.png']);
    expect(new TextDecoder().decode(opened.files[0].bytes)).toBe('# A\n');
    expect(Array.from(opened.files[1].bytes)).toEqual([0, 1, 2, 255]);
    expect(opened.manifest.senderName).toBe('Alice');
  });

  it('keeps file names out of the cleartext', async () => {
    const sealed = await seal(randomBytes(32));
    const asText = new TextDecoder('latin1').decode(sealed);
    expect(asText).not.toContain('a.md');
    expect(asText).not.toContain('# A');
  });

  it('refuses a wrong key', async () => {
    const sealed = await seal(randomBytes(32));
    await expect(openPackage(sealed, randomBytes(32))).rejects.toBeInstanceOf(PackageFormatError);
  });

  it('refuses an edited header (it is bound as AAD)', async () => {
    const dek = randomBytes(32);
    const sealed = await seal(dek);
    const text = new TextDecoder().decode(sealed.subarray(12, 12 + 200));
    const at = 12 + text.indexOf('ow.example.com');
    const tampered = sealed.slice();
    tampered[at] = 'x'.charCodeAt(0);
    expect(readPackageHeader(tampered).header.serverOrigin).toBe('https://xw.example.com');
    await expect(openPackage(tampered, dek)).rejects.toBeInstanceOf(PackageFormatError);
  });

  it('refuses an edited body', async () => {
    const dek = randomBytes(32);
    const sealed = await seal(dek);
    const tampered = sealed.slice();
    tampered[tampered.length - 5] ^= 0xff;
    await expect(openPackage(tampered, dek)).rejects.toBeInstanceOf(PackageFormatError);
  });

  it('rejects bytes that are not a package', () => {
    expect(() => readPackageHeader(enc('hello world, not a package'))).toThrow(PackageFormatError);
    expect(() => readPackageHeader(new Uint8Array(4))).toThrow(PackageFormatError);
  });
});
