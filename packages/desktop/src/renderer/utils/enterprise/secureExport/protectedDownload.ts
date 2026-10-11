/**
 * Copyright 2026 One Work
 */

/**
 * Gateway-aware versions of the three browser-download helpers in
 * `utils/file/download.ts`, for the call sites that take content out of the
 * app (preview download, tool-output download, media save, team export).
 *
 * Outside a company — or for a company without export protection — each one
 * calls the original helper untouched, so personal behaviour is byte-for-byte
 * what it was.
 */

import i18next from 'i18next';
import { Message } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type { ChatFileRef } from '@/common/types/chatFile';
import { buildFileStreamUrl } from '@renderer/utils/file/fileUrls';
import { BINARY_MIME_MAP } from '@renderer/utils/file/base64';
import { downloadFileFromPath, downloadFileFromRef, downloadTextContent } from '@renderer/utils/file/download';
import type { ExportKind } from './events';
import { downloadDecision, prepareExport, type ExportFileInput } from './gateway';
import { base64ToBytes } from './packageFormat';
import { isSecureExportEnterpriseActive } from './policy';
import { isWatermarkable } from './watermark';

export type ProtectedDownloadResult = 'done' | 'cancelled' | 'blocked';

const translate = (key: string, values?: Record<string, unknown>) => String(i18next.t(key, values));

function mimeFor(fileName: string, fallback = 'application/octet-stream'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_MIME_MAP[ext] ?? fallback;
}

/** Markdown travels as text so it can be watermarked; everything else as bytes. */
function asExportFile(fileName: string, bytes: Uint8Array<ArrayBuffer>): ExportFileInput {
  return isWatermarkable(fileName)
    ? { name: fileName, text: new TextDecoder().decode(bytes) }
    : { name: fileName, bytes };
}

async function runGateway(kind: ExportKind, file: ExportFileInput, mimeType: string): Promise<ProtectedDownloadResult> {
  const decision = await prepareExport({ kind, files: [file], suggestedName: file.name, t: translate });
  if (decision.mode === 'cancelled') return 'cancelled';
  if (decision.mode === 'blocked') {
    Message.error({ content: decision.message, duration: 6000 });
    return 'blocked';
  }
  downloadDecision(decision, mimeType);
  return 'done';
}

export async function protectedDownloadText(
  content: string,
  fileName: string,
  mimeType: string,
  kind: ExportKind
): Promise<ProtectedDownloadResult> {
  if (!isSecureExportEnterpriseActive()) {
    downloadTextContent(content, fileName, mimeType);
    return 'done';
  }
  return runGateway(kind, { name: fileName, text: content }, mimeType);
}

/**
 * Outside export protection this returns the original helper's own promise,
 * called with the caller's exact arguments: same timing, same call shape.
 */
export function protectedDownloadFromPath(
  filePath: string,
  fileName: string,
  kind: ExportKind,
  workspace?: string
): Promise<ProtectedDownloadResult | void> {
  if (!isSecureExportEnterpriseActive()) {
    return workspace === undefined
      ? downloadFileFromPath(filePath, fileName)
      : downloadFileFromPath(filePath, fileName, workspace);
  }
  return gatedDownloadFromPath(filePath, fileName, kind, workspace);
}

async function gatedDownloadFromPath(
  filePath: string,
  fileName: string,
  kind: ExportKind,
  workspace?: string
): Promise<ProtectedDownloadResult> {
  const dataUrl = await ipcBridge.fs.getImageBase64.invoke({ path: filePath, workspace });
  if (!dataUrl) throw new Error('File data not found');
  return runGateway(kind, asExportFile(fileName, base64ToBytes(dataUrl)), mimeFor(fileName));
}

export function protectedDownloadFromRef(
  file: ChatFileRef,
  fileName: string,
  kind: ExportKind
): Promise<ProtectedDownloadResult | void> {
  if (!isSecureExportEnterpriseActive()) return downloadFileFromRef(file, fileName);
  return gatedDownloadFromRef(file, fileName, kind);
}

async function gatedDownloadFromRef(
  file: ChatFileRef,
  fileName: string,
  kind: ExportKind
): Promise<ProtectedDownloadResult> {
  const response = await fetch(buildFileStreamUrl(file));
  if (!response.ok) throw new Error(`File download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('File data is empty');
  return runGateway(kind, asExportFile(fileName, bytes), mimeFor(fileName));
}

export async function protectedDownloadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string,
  mimeType: string,
  kind: ExportKind
): Promise<ProtectedDownloadResult> {
  if (!isSecureExportEnterpriseActive()) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return 'done';
  }
  return runGateway(kind, asExportFile(fileName, bytes), mimeType);
}
