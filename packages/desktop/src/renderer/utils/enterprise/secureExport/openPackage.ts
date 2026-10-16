/**
 * Copyright 2026 One Work
 */

/**
 * Open a `.owenc` file: read it, make sure it belongs to the company server
 * this client is signed in to, get its key from that server, decrypt in
 * memory. Nothing decrypted is ever written to disk.
 */

import { ipcBridge } from '@/common';
import type { SecurePackage } from '@/common/adapter/ipcBridge';
import { chatFileRefPath, type ChatFileRef } from '@/common/types/chatFile';
import { getEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  PackageFormatError,
  MAX_PACKAGE_BYTES,
  base64ToBytes,
  openPackage,
  readPackageHeader,
  type PackageFile,
  type PackageHeader,
} from './packageFormat';
import { isSecureExportEnterpriseActive } from './policy';

export type OpenedPackage = {
  header: PackageHeader;
  info: SecurePackage;
  files: PackageFile[];
  sourcePath: string;
};

/** `value` when it opened, `message` (ready to show) when it did not. */
export type OpenPackageResult = { ok: boolean; value?: OpenedPackage; message?: string };
export type SecurePackageSource = string | ChatFileRef;

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** Scheme + host + port, lowercased, no trailing slash — what "the same server" means. */
export function normalizeOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return url.trim().replace(/\/+$/, '').toLowerCase();
  }
}

function serverErrorMessage(error: unknown, t: Translate): string {
  if (!isBackendHttpError(error) || error.status === 0) return t('messages.secureExport.openOffline');
  switch (error.code) {
    case 'PACKAGE_REVOKED':
      return t('messages.secureExport.openRevoked');
    case 'PACKAGE_EXPIRED':
      return t('messages.secureExport.openExpired');
    case 'NOT_FOUND':
      return t('messages.secureExport.openNotFound');
    case 'FORBIDDEN':
      return t('messages.secureExport.openNotRecipient');
    case 'PLAN_FEATURE_REQUIRED':
      return t('messages.secureExport.openPlanRequired');
    case 'RATE_LIMITED':
      return t('messages.secureExport.openRateLimited');
    case 'NOT_IN_ENTERPRISE':
      return t('messages.secureExport.openNeedsEnterprise');
    default:
      return t('messages.secureExport.openFailed', { reason: error.backendMessage || error.code });
  }
}

export async function loadSecurePackage(source: SecurePackageSource, t: Translate): Promise<OpenPackageResult> {
  const sourcePath = typeof source === 'string' ? source : chatFileRefPath(source);
  const base64 = await (async () => {
    if (typeof source === 'string') return ipcBridge.secureExport.readBinary.invoke({ path: source });
    // Keep project files addressed by their scoped reference. Never resolve an
    // absolute path in the renderer or send encrypted bytes through text preview.
    const metadata = await ipcBridge.fs.getContentMetadata.invoke({ file: source });
    if (!metadata || metadata.size > MAX_PACKAGE_BYTES) return null;
    return ipcBridge.fs.readContent.invoke({ file: source, encoding: 'base64' });
  })().catch((): null => null);
  if (!base64) return { ok: false, message: t('messages.secureExport.openUnreadable') };
  const bytes = base64ToBytes(base64);
  if (bytes.length > MAX_PACKAGE_BYTES) return { ok: false, message: t('messages.secureExport.openUnreadable') };

  let header: PackageHeader;
  try {
    header = readPackageHeader(bytes).header;
  } catch {
    return { ok: false, message: t('messages.secureExport.openNotPackage') };
  }

  // Only ever ask the server this client is already signed in to. The header
  // names a server, and following it would let a crafted file send the member
  // to a look-alike login page; a mismatch is reported, never acted on.
  const current = getEnterpriseServerUrl();
  if (!isSecureExportEnterpriseActive() || !current) {
    return { ok: false, message: t('messages.secureExport.openNeedsEnterprise') };
  }
  if (normalizeOrigin(current) !== normalizeOrigin(header.serverOrigin)) {
    return {
      ok: false,
      message: t('messages.secureExport.openOtherServer', { origin: normalizeOrigin(header.serverOrigin) }),
    };
  }

  let opened: { dek: string; package: SecurePackage };
  try {
    opened = await ipcBridge.onePlatform.openSecurePackage.invoke({ packageId: header.packageId });
  } catch (error) {
    return { ok: false, message: serverErrorMessage(error, t) };
  }

  try {
    const dek = base64ToBytes(opened.dek);
    const { files } = await openPackage(bytes, dek);
    dek.fill(0);
    return { ok: true, value: { header, info: opened.package, files, sourcePath } };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof PackageFormatError
          ? t('messages.secureExport.openCorrupted')
          : t('messages.secureExport.openFailed', { reason: String(error) }),
    };
  }
}

let opener: ((source: SecurePackageSource) => void) | null = null;

/** Registered by the app shell's host; the one place that shows packages. */
export function setSecurePackageOpener(next: ((source: SecurePackageSource) => void) | null): void {
  opener = next;
}

/** Ask the shell to open a package file (from a button, a picker, a link). */
export function requestOpenSecurePackage(source: SecurePackageSource): boolean {
  if (!opener) return false;
  opener(source);
  return true;
}
