/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { httpDownloadBinary } from '@/common/adapter/httpBridge';
import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';
import { FileService, type FileMetadata } from '@/renderer/services/FileService';
import { libraryFileKind } from '../shared/LibraryFileIcon';
import { usesOriginalFile } from '../original/sourceKind';

/** Most documents one "add from library" action will carry into a conversation. */
export const MAX_LIBRARY_ATTACHMENTS = 20;

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/html': '.html',
};

const hasExtension = (name: string): boolean => /\.[a-z0-9]{1,5}$/i.test(name);

/** Titles of in-app documents carry no extension; the agent needs one to pick a reader. */
const fileNameFor = (doc: RagDocumentEntry, mime: string): string => {
  const title = doc.title.trim() || 'document';
  if (hasExtension(title)) return title;
  const kind = libraryFileKind(doc);
  if (kind === 'markdown') return `${title}.md`;
  if (kind === 'csv') return `${title}.csv`;
  return `${title}${EXTENSION_BY_MIME[mime] ?? ''}`;
};

/**
 * Turns a library document into a `File` the conversation upload path accepts:
 * the stored original when there is one (so a PDF stays a PDF), the editable
 * body for Markdown and CSV documents.
 */
export async function libraryDocumentToFile(doc: RagDocumentEntry): Promise<File> {
  if (usesOriginalFile(doc.filePath, doc.mimeType)) {
    const { blob } = await httpDownloadBinary(`/api/one/devops/rag/documents/${doc.id}/source`);
    const mime = doc.mimeType || blob.type || 'application/octet-stream';
    return new File([blob], fileNameFor(doc, mime), { type: mime });
  }
  const content = (await ipcBridge.oneDevops.getRagContent.invoke({ id: doc.id })) ?? '';
  const mime = libraryFileKind(doc) === 'csv' ? 'text/csv' : 'text/markdown';
  return new File([content], fileNameFor(doc, mime), { type: mime });
}

/** `processDroppedFiles` only indexes into the list, so a plain array is enough. */
const toFileList = (files: File[]): FileList =>
  Object.assign([...files], { item: (index: number) => files[index] ?? null }) as unknown as FileList;

/**
 * Copies library documents into the conversation's upload area and returns the
 * resulting attachments. Without a conversation id they land in temporary
 * storage, which is what the new-conversation page expects.
 */
export async function uploadLibraryDocuments(
  docs: RagDocumentEntry[],
  conversationId?: string
): Promise<FileMetadata[]> {
  const files = await Promise.all(docs.slice(0, MAX_LIBRARY_ATTACHMENTS).map(libraryDocumentToFile));
  if (files.length === 0) return [];
  return FileService.processDroppedFiles(toFileList(files), conversationId);
}

/** Same as {@link uploadLibraryDocuments} for callers that only keep paths. */
export async function uploadLibraryDocumentPaths(docs: RagDocumentEntry[], conversationId?: string): Promise<string[]> {
  return (await uploadLibraryDocuments(docs, conversationId)).map((file) => file.path);
}
