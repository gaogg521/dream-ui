/**
 * Copyright 2026 One Work
 */

/**
 * `.owenc` — an encrypted outbound package.
 *
 *   offset 0   "OWENC" 0x00 0x01 0x00            magic + format version (8 bytes)
 *   offset 8   u32 big-endian header length
 *   offset 12  header (UTF-8 JSON, cleartext)
 *   …          AES-256-GCM(dek, header.nonce, payload, AAD = bytes 0..12 + header)
 *
 * The header carries only what opening needs — which server holds the key and
 * which package to ask for. File names and the sender are inside the payload,
 * so a copy that leaks out of the company says nothing about its contents.
 * Binding the header as AAD means editing it (pointing the file at another
 * server, say) makes decryption fail instead of quietly working.
 *
 * Payload: u32 big-endian manifest length, manifest JSON, then every file's
 * bytes back to back in manifest order. Only One Work reads it, so there is
 * no reason to pull a zip library into the renderer for it.
 */

const MAGIC = new Uint8Array([0x4f, 0x57, 0x45, 0x4e, 0x43, 0x00, 0x01, 0x00]);
const PREFIX_LENGTH = MAGIC.length + 4;
const NONCE_LENGTH = 12;
/** Packages are built and opened in memory; past this, use another channel. */
export const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
export const PACKAGE_EXTENSION = 'owenc';

export type PackageHeader = {
  v: 1;
  packageId: string;
  serverOrigin: string;
  enterpriseId: string;
  alg: 'A256GCM';
  nonce: string;
  createdAt: number;
};

export type PackageFile = { name: string; bytes: Uint8Array<ArrayBuffer> };

export type PackageManifest = {
  v: 1;
  files: Array<{ name: string; size: number; sha256: string }>;
  senderName: string;
  createdAt: number;
};

export class PackageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageFormatError';
  }
}

export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function u32(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function readU32(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function concat(parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** UUID v4 from the platform RNG; package ids are client-minted. */
export function newPackageId(): string {
  return crypto.randomUUID();
}

export async function buildPayload(
  files: PackageFile[],
  senderName: string,
  createdAt: number
): Promise<{ payload: Uint8Array<ArrayBuffer>; manifest: PackageManifest }> {
  const manifest: PackageManifest = {
    v: 1,
    files: await Promise.all(
      files.map(async (f) => ({ name: f.name, size: f.bytes.length, sha256: await sha256Hex(f.bytes) }))
    ),
    senderName,
    createdAt,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return {
    payload: concat([u32(manifestBytes.length), manifestBytes, ...files.map((f) => f.bytes)]),
    manifest,
  };
}

async function importKey(dek: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', dek, { name: 'AES-GCM' }, false, [usage]);
}

/** Encrypt `payload` under `dek` and frame it as a `.owenc` file. */
export async function sealPackage(
  payload: Uint8Array<ArrayBuffer>,
  dek: Uint8Array<ArrayBuffer>,
  header: Omit<PackageHeader, 'v' | 'alg' | 'nonce'>
): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = randomBytes(NONCE_LENGTH);
  const fullHeader: PackageHeader = { v: 1, alg: 'A256GCM', nonce: bytesToBase64(nonce), ...header };
  const headerBytes = new TextEncoder().encode(JSON.stringify(fullHeader));
  const prefix = concat([MAGIC, u32(headerBytes.length)]);
  const aad = concat([prefix, headerBytes]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad },
      await importKey(dek, 'encrypt'),
      payload
    )
  );
  const sealed = concat([aad, ciphertext]);
  if (sealed.length > MAX_PACKAGE_BYTES) {
    throw new PackageFormatError('package exceeds the size limit');
  }
  return sealed;
}

/** Read the cleartext header; throws when the bytes are not a `.owenc` file. */
export function readPackageHeader(bytes: Uint8Array<ArrayBuffer>): {
  header: PackageHeader;
  aad: Uint8Array<ArrayBuffer>;
  body: Uint8Array<ArrayBuffer>;
} {
  if (bytes.length < PREFIX_LENGTH || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new PackageFormatError('not a One Work encrypted file');
  }
  const headerLength = readU32(bytes, MAGIC.length);
  const headerEnd = PREFIX_LENGTH + headerLength;
  if (headerLength === 0 || headerEnd > bytes.length) {
    throw new PackageFormatError('damaged header');
  }
  let header: PackageHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(PREFIX_LENGTH, headerEnd))) as PackageHeader;
  } catch {
    throw new PackageFormatError('damaged header');
  }
  if (header?.v !== 1 || header.alg !== 'A256GCM' || !header.packageId || !header.nonce || !header.serverOrigin) {
    throw new PackageFormatError('unsupported package version');
  }
  return { header, aad: bytes.subarray(0, headerEnd), body: bytes.subarray(headerEnd) };
}

/** Decrypt and unpack. A wrong key or any edited byte fails here. */
export async function openPackage(
  bytes: Uint8Array<ArrayBuffer>,
  dek: Uint8Array<ArrayBuffer>
): Promise<{ header: PackageHeader; manifest: PackageManifest; files: PackageFile[] }> {
  const { header, aad, body } = readPackageHeader(bytes);
  let payload: Uint8Array<ArrayBuffer>;
  try {
    payload = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(header.nonce), additionalData: aad },
        await importKey(dek, 'decrypt'),
        body
      )
    );
  } catch {
    throw new PackageFormatError('decryption failed');
  }
  const manifestLength = readU32(payload, 0);
  const manifest = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + manifestLength))) as PackageManifest;
  let offset = 4 + manifestLength;
  const files: PackageFile[] = [];
  for (const entry of manifest.files) {
    const fileBytes = payload.subarray(offset, offset + entry.size);
    offset += entry.size;
    // oxlint-disable-next-line no-await-in-loop -- sequential by design; a handful of files
    if ((await sha256Hex(fileBytes)) !== entry.sha256) {
      throw new PackageFormatError(`file ${entry.name} does not match its checksum`);
    }
    files.push({ name: entry.name, bytes: fileBytes });
  }
  return { header, manifest, files };
}
