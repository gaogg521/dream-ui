/**
 * Copyright 2026 One Work
 */

/**
 * Export watermark: one render-invisible line at the end of an exported
 * Markdown file,
 *
 *   <!-- ow:wm1.<seedId>.<ts>.<hash>.<mac> -->
 *
 * where `seedId` is the opaque id of this machine's signing seed, `ts` the
 * export time (Unix seconds, base36), `hash` the first 8 bytes of SHA-256 over
 * the normalized body and `mac` the first 8 bytes of
 * HMAC-SHA256(seedKey, "wm1|seedId|ts|hash"). Only an admin can resolve the
 * seed id to a person (dream-core `secure_export.rs`).
 *
 * The server verifies these lines, so the format here and there must agree
 * byte for byte; both sides pin the same test vector.
 */

export const WATERMARK_PREFIX = '<!-- ow:wm1.';
const WATERMARK_SUFFIX = '-->';

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/** Whether a file of this name gets a watermark. Only Markdown does. */
export function isWatermarkable(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Trim the four ASCII blanks only. `String.prototype.trim` also removes
 * U+FEFF and friends, which Rust's `trim` does not — the two hashes would
 * then disagree on a file starting with a BOM.
 */
function trimBlanks(text: string, end: 'both' | 'end'): string {
  let start = 0;
  let stop = text.length;
  const isBlank = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
  if (end === 'both') {
    while (start < stop && isBlank(text[start])) start += 1;
  }
  while (stop > start && isBlank(text[stop - 1])) stop -= 1;
  return text.slice(start, stop);
}

export function isWatermarkLine(line: string): boolean {
  const t = trimBlanks(line, 'both');
  return t.startsWith(WATERMARK_PREFIX) && t.endsWith(WATERMARK_SUFFIX);
}

/** The text a watermark's hash covers: CRLF unified, marks removed, trailing blanks dropped. */
export function normalizeForHash(text: string): string {
  const kept = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !isWatermarkLine(line));
  return trimBlanks(kept.join('\n'), 'end');
}

function toHex(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>, length: number): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) out += view[i].toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest, 32);
}

export async function contentHashPrefix(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeForHash(text)));
  return toHex(digest, 8);
}

export async function watermarkMac(
  key: Uint8Array<ArrayBuffer>,
  seedId: string,
  tsBase36: string,
  hash: string
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(`wm1|${seedId}|${tsBase36}|${hash}`)
  );
  return toHex(signature, 8);
}

/** The watermark line for `text`, without a trailing newline. */
export async function watermarkLine(
  key: Uint8Array<ArrayBuffer>,
  seedId: string,
  tsSeconds: number,
  text: string
): Promise<string> {
  const ts = Math.floor(tsSeconds).toString(36);
  const hash = await contentHashPrefix(text);
  const mac = await watermarkMac(key, seedId, ts, hash);
  return `${WATERMARK_PREFIX}${seedId}.${ts}.${hash}.${mac} ${WATERMARK_SUFFIX}`;
}

/**
 * Stamp `text`: drop any earlier mark (re-exporting a stamped file must not
 * stack lines), keep everything else as it was, and append a fresh mark
 * after a blank line.
 */
export async function stampMarkdown(
  text: string,
  key: Uint8Array<ArrayBuffer>,
  seedId: string,
  tsSeconds: number
): Promise<string> {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text
    .split(/\r?\n/)
    .filter((line) => !isWatermarkLine(line))
    .join(eol);
  const line = await watermarkLine(key, seedId, tsSeconds, body);
  return `${trimBlanks(body, 'end')}${eol}${eol}${line}${eol}`;
}
