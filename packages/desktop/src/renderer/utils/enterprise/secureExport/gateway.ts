/**
 * Copyright 2026 One Work
 */

/**
 * The export gateway. Every path that takes content out of One Work — the
 * conversation exports, the history zip, previews' download, tool and media
 * downloads, the team export — passes its files through {@link prepareExport}
 * before writing anything.
 *
 * Why the client: exports happen in this process and never touch a backend
 * that could gate them (and a member's local dreamcore is a personal build
 * with no enterprise code in it at all). Design:
 * dream-en docs/design-2026-10-11-secure-export-and-watermark.zh-CN.md.
 *
 * Personal mode, or a company whose plan lacks the feature: the files come
 * back untouched and nothing is recorded — byte-identical to having no
 * gateway at all.
 */

import { ipcBridge } from '@/common';
import { getEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { recordExportEvent, type ExportKind } from './events';
import {
  MAX_PACKAGE_BYTES,
  PACKAGE_EXTENSION,
  buildPayload,
  bytesToBase64,
  newPackageId,
  randomBytes,
  sealPackage,
} from './packageFormat';
import { getWatermarkSeed, isSecureExportEnterpriseActive, loadExportPolicy, type ExportPolicy } from './policy';
import { askExportProtection, type ProtectionChoice } from './protectionDialog';
import { isWatermarkable, sha256Hex, stampMarkdown } from './watermark';

export type ExportFileInput = { name: string; text?: string; bytes?: Uint8Array<ArrayBuffer> };

export type PlainExport = {
  mode: 'plain';
  files: ExportFileInput[];
  /** Call once the files were written, so the record says what actually left. */
  report: () => void;
};

export type EncryptedExport = {
  mode: 'encrypted';
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
  report: () => void;
};

export type ExportDecision =
  | PlainExport
  | EncryptedExport
  | { mode: 'cancelled' }
  | { mode: 'blocked'; reason: 'offline' | 'too_large' | 'failed'; message: string };

type Translate = (key: string, values?: Record<string, unknown>) => string;

const NOOP = () => {};

function fileBytes(file: ExportFileInput): Uint8Array<ArrayBuffer> {
  if (file.bytes) return file.bytes;
  return new TextEncoder().encode(file.text ?? '');
}

function concatBytes(files: ExportFileInput[]): Uint8Array<ArrayBuffer> {
  const parts = files.map(fileBytes);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Base name for the package: the single file's name, else the caller's suggestion. */
export function packageFileName(files: ExportFileInput[], suggested: string): string {
  const base = files.length === 1 ? files[0].name : suggested;
  const stem = base.replace(/\.[^./\\]+$/, '') || 'export';
  return `${stem}.${PACKAGE_EXTENSION}`;
}

async function applyWatermark(
  files: ExportFileInput[],
  policy: ExportPolicy
): Promise<{ files: ExportFileInput[]; seedId?: string }> {
  if (!policy.watermark || !files.some((f) => isWatermarkable(f.name) && f.text !== undefined)) {
    return { files };
  }
  const seed = await getWatermarkSeed();
  if (!seed) return { files };
  const now = Math.floor(Date.now() / 1000);
  const stamped = await Promise.all(
    files.map(async (f) =>
      isWatermarkable(f.name) && f.text !== undefined
        ? { ...f, text: await stampMarkdown(f.text, seed.key, seed.seedId, now) }
        : f
    )
  );
  return { files: stamped, seedId: seed.seedId };
}

/**
 * Decide how `files` leave the machine, watermark them, and — when the member
 * (or the policy) chose encryption — seal them into one `.owenc` package
 * whose key the company server holds.
 *
 * The caller writes whatever comes back and calls `report()` afterwards.
 * `blocked` means nothing may be written: the policy requires encryption and
 * the key could not be deposited, or the export is too large to package.
 */
export async function prepareExport(request: {
  kind: ExportKind;
  files: ExportFileInput[];
  /** Used for the package name when there is more than one file. */
  suggestedName: string;
  t: Translate;
}): Promise<ExportDecision> {
  if (!isSecureExportEnterpriseActive()) {
    return { mode: 'plain', files: request.files, report: NOOP };
  }
  const policy = await loadExportPolicy({ fresh: true });
  if (!policy.entitled) {
    return { mode: 'plain', files: request.files, report: NOOP };
  }

  const choice: ProtectionChoice | null = await askExportProtection({
    mode: policy.encryptionMode,
    watermark: policy.watermark,
    fileCount: request.files.length,
    t: request.t,
  });
  if (!choice) return { mode: 'cancelled' };

  const { files, seedId } = await applyWatermark(request.files, policy);
  const fileNames = files.map((f) => f.name);
  const plainBytes = concatBytes(files);

  if (!choice.encrypt) {
    const contentSha256 = await sha256Hex(plainBytes);
    return {
      mode: 'plain',
      files,
      report: () =>
        recordExportEvent({
          kind: request.kind,
          encrypted: false,
          seedId,
          fileNames,
          totalBytes: plainBytes.length,
          contentSha256,
        }),
    };
  }

  if (plainBytes.length > MAX_PACKAGE_BYTES) {
    return { mode: 'blocked', reason: 'too_large', message: request.t('messages.secureExport.tooLarge') };
  }
  const serverOrigin = getEnterpriseServerUrl();
  if (!serverOrigin) {
    return { mode: 'blocked', reason: 'offline', message: request.t('messages.secureExport.offline') };
  }

  try {
    const plan = await ipcBridge.oneBilling.myPlan.invoke();
    const enterpriseId = (plan as { enterpriseId?: string } | undefined)?.enterpriseId ?? '';
    const packageId = newPackageId();
    const createdAt = Date.now();
    const dek = randomBytes(32);
    const { payload } = await buildPayload(
      files.map((f) => ({ name: f.name, bytes: fileBytes(f) })),
      '',
      createdAt
    );
    const sealed = await sealPackage(payload, dek, { packageId, serverOrigin, enterpriseId, createdAt });
    const contentSha256 = await sha256Hex(plainBytes);
    // Deposit the key before anything is written: a package whose key never
    // reached the server is a file nobody — the sender included — can open.
    await ipcBridge.onePlatform.createSecurePackage.invoke({
      packageId,
      dek: bytesToBase64(dek),
      recipientScope: choice.recipientScope,
      recipientUserIds: choice.recipientScope === 'users' ? choice.recipientUserIds : [],
      expiresAt: choice.expiresInDays === null ? null : createdAt + choice.expiresInDays * 24 * 60 * 60 * 1000,
      fileNames,
      totalBytes: plainBytes.length,
      contentSha256,
      seedId,
    });
    dek.fill(0);
    return {
      mode: 'encrypted',
      fileName: packageFileName(files, request.suggestedName),
      bytes: sealed,
      report: () =>
        recordExportEvent({
          kind: request.kind,
          encrypted: true,
          packageId,
          seedId,
          fileNames,
          totalBytes: plainBytes.length,
          contentSha256,
        }),
    };
  } catch (error) {
    console.error('[secureExport] encrypted export failed:', error);
    const offline = !isBackendHttpError(error) || error.status === 0;
    return {
      mode: 'blocked',
      reason: offline ? 'offline' : 'failed',
      message: offline
        ? request.t('messages.secureExport.offline')
        : request.t('messages.secureExport.failed', { reason: error.backendMessage || error.code }),
    };
  }
}

/** Whether a plain "copy everything" action is allowed right now (cached policy, no round trip). */
export async function isPlainCopyAllowed(): Promise<boolean> {
  if (!isSecureExportEnterpriseActive()) return true;
  const policy = await loadExportPolicy({ fresh: false });
  return !(policy.entitled && policy.encryptionMode === 'required');
}

/**
 * Record an explicit "copy all" action (not ordinary Ctrl+C). Only the size
 * travels, never the text.
 */
export async function recordClipboardCopy(chars: number): Promise<void> {
  if (!isSecureExportEnterpriseActive()) return;
  const policy = await loadExportPolicy({ fresh: false });
  if (!policy.entitled) return;
  recordExportEvent({ kind: 'clipboard', encrypted: false, fileNames: [], totalBytes: chars });
}

/** Trigger a browser download for whatever the gateway decided. */
export function downloadDecision(decision: PlainExport | EncryptedExport, mimeType: string): void {
  if (decision.mode === 'encrypted') {
    triggerDownload(new Blob([decision.bytes], { type: 'application/octet-stream' }), decision.fileName);
  } else {
    for (const file of decision.files) {
      triggerDownload(new Blob([fileBytes(file)], { type: mimeType }), file.name);
    }
  }
  decision.report();
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Write an encrypted package to an absolute path (desktop). */
export async function writeEncryptedPackage(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  return ipcBridge.secureExport.writeBinary.invoke({ path, base64: bytesToBase64(bytes) });
}

/**
 * Record an export that left through a path with its own protection — the
 * passphrase-encrypted backup archive. Names and size only.
 */
export async function recordOutboundExport(kind: ExportKind, fileNames: string[], totalBytes: number): Promise<void> {
  if (!isSecureExportEnterpriseActive()) return;
  const policy = await loadExportPolicy({ fresh: false });
  if (!policy.entitled) return;
  recordExportEvent({ kind, encrypted: false, fileNames, totalBytes });
}
