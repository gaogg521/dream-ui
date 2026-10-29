/** Copyright 2026 One Work */
import { ipcBridge } from '@/common';
import { httpUploadMultipart } from '@/common/adapter/httpBridge';
import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';
import { cacheOriginal, originalCacheKey } from '../original/originalCache';

export const SOURCE_LIMIT = 100 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
export const uploadTimeoutMs = (bytes: number): number => Math.max(120_000, Math.ceil(bytes / (1024 * 1024)) * 8_000);
export const indexableText = (text: string): string =>
  new TextEncoder().encode(text).length > 12 * 1024 * 1024 ? '' : text;
const aborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
};

/** Shared registration/upload path for both library imports and conversation artifacts. */
export async function saveLibraryOriginal(input: {
  title: string;
  content: string;
  personal: boolean;
  libraryId?: string;
  source?: string | File;
  signal?: AbortSignal;
}): Promise<RagDocumentEntry> {
  const { signal } = input;
  aborted(signal);
  let original: File | undefined;
  if (typeof input.source === 'string') {
    const pieces: Blob[] = [];
    let name = '';
    for (let offset = 0, size = 1; offset < size; ) {
      aborted(signal);
      const chunk = await ipcBridge.application.readRagSourceChunk.invoke({
        filePath: input.source,
        offset,
        length: CHUNK_BYTES,
      });
      if ('error' in chunk) throw new Error(chunk.error);
      if (chunk.size > SOURCE_LIMIT) throw new Error('Artifact exceeds the 100 MiB import limit');
      name = chunk.name;
      size = chunk.size;
      const piece = await (await fetch(`data:application/octet-stream;base64,${chunk.base64}`)).blob();
      if (!piece.size && offset < size) throw new Error('Source file changed or could not be read completely');
      pieces.push(piece);
      offset += piece.size;
    }
    original = new File(pieces, name);
  } else original = input.source;
  if (original && original.size > SOURCE_LIMIT) throw new Error('Artifact exceeds the 100 MiB import limit');
  aborted(signal);
  const doc = await ipcBridge.oneDevops.registerRagDocument.invoke({
    title: input.title,
    ...(input.libraryId ? { libraryId: input.libraryId } : {}),
    ...(input.personal ? { scope: 'personal' as const } : {}),
    ...(original?.type ? { mimeType: original.type } : {}),
  });
  if (!doc?.id) throw new Error('registerRagDocument returned no id');
  try {
    aborted(signal);
    if (original) {
      const stored = await httpUploadMultipart<RagDocumentEntry>(
        `/api/one/devops/rag/documents/${doc.id}/source`,
        original,
        'file',
        { timeoutMs: uploadTimeoutMs(original.size), signal }
      );
      if (stored?.filePath) cacheOriginal(originalCacheKey(doc.id, stored.filePath), original);
    }
    aborted(signal);
    if (input.content.trim()) {
      const { revision } = await ipcBridge.oneDevops.getRagContentState.invoke({ id: doc.id });
      await ipcBridge.oneDevops.setRagContent.invoke({
        id: doc.id,
        content: input.content,
        expectedRevision: revision,
      });
    }
    return doc;
  } catch (error) {
    await ipcBridge.oneDevops.deleteRagDocument.invoke({ id: doc.id }).catch(() => {});
    throw error;
  }
}

/** Extract first, then retain the original even when its format has no indexable text. */
export async function importLocalArtifact(
  filePath: string,
  target: { personal: boolean; libraryId?: string },
  signal: AbortSignal
): Promise<{ document: RagDocumentEntry; sourceOnly: boolean }> {
  const jobId = crypto.randomUUID();
  const cancel = (): void => {
    void ipcBridge.application.cancelRagExtraction.invoke({ jobId });
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    aborted(signal);
    const [result] = await ipcBridge.application.extractRagDocumentFiles.invoke({ filePaths: [filePath], jobId });
    aborted(signal);
    if (!result) throw new Error('No extraction result');
    if (result.fileSize > SOURCE_LIMIT) throw new Error('Artifact exceeds the 100 MiB import limit');
    const content = 'error' in result ? '' : indexableText(result.text);
    const document = await saveLibraryOriginal({
      title: result.fileName,
      source: result.filePath,
      content,
      ...target,
      signal,
    });
    return { document, sourceOnly: !content.trim() };
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
