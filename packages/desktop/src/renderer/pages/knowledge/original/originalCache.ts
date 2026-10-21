/**
 * Session-scoped cache of library originals, so re-opening a document (or opening one right after it was
 * uploaded) does not download the whole file again. The server answers `no-store`, and for an enterprise
 * client every open is a transfer from the remote server.
 *
 * Keys must change whenever the stored bytes change: they are `<documentId>:<rag-source:uuid>`, and a replaced
 * original gets a new storage key.
 */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const entries = new Map<string, Blob>();
let totalBytes = 0;

/** The key the original viewer uses for a document's current original. */
export const originalCacheKey = (documentId: string, sourcePath: string | null | undefined) =>
  `${documentId}:${sourcePath ?? ''}`;

export function getCachedOriginal(key: string): Blob | undefined {
  const blob = entries.get(key);
  if (!blob) return undefined;
  // Refresh recency: Map iterates in insertion order.
  entries.delete(key);
  entries.set(key, blob);
  return blob;
}

export function cacheOriginal(key: string, blob: Blob): void {
  if (blob.size === 0 || blob.size > MAX_TOTAL_BYTES) return;
  const previous = entries.get(key);
  if (previous) {
    totalBytes -= previous.size;
    entries.delete(key);
  }
  entries.set(key, blob);
  totalBytes += blob.size;
  for (const [oldest, value] of entries) {
    if (totalBytes <= MAX_TOTAL_BYTES) break;
    entries.delete(oldest);
    totalBytes -= value.size;
  }
}

/** Test seam. */
export function clearOriginalCache(): void {
  entries.clear();
  totalBytes = 0;
}
