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
import { getEnterpriseServerUrl } from '@/common/adapter/enterpriseMode';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import {
  PackageFormatError,
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

export async function loadSecurePackage(sourcePath: string, t: Translate): Promise<OpenPackageResult> {
  const base64 = await ipcBridge.secureExport.readBinary.invoke({ path: sourcePath }).catch((): null => null);
  if (!base64) return { ok: false, message: t('messages.secureExport.openUnreadable') };
  const bytes = base64ToBytes(base64);

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

let opener: ((path: string) => void) | null = null;

/** Registered by the app shell's host; the one place that shows packages. */
export function setSecurePackageOpener(next: ((path: string) => void) | null): void {
  opener = next;
}

/** Ask the shell to open a package file (from a button, a picker, a link). */
export function requestOpenSecurePackage(path: string): boolean {
  if (!opener) return false;
  opener(path);
  return true;
}
