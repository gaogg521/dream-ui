/**
 * Copyright 2026 One Work
 */

/**
 * Secure-export file I/O and `.owenc` file association.
 *
 * The renderer does all the cryptography (WebCrypto) and all the talking to
 * the company server; what it cannot do is touch the filesystem with binary
 * data — the local backend's fs endpoints are text-only — or hear about a
 * file the OS asked this app to open. Both live here.
 *
 * Opening requests can arrive before any window exists (a double-click that
 * launches the app), so they are queued until the renderer takes them.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcBridge } from '@/common';

/** Same ceiling as the renderer's package builder; nothing larger is ever written. */
const MAX_BINARY_BYTES = 200 * 1024 * 1024;
const PACKAGE_EXTENSION = '.owenc';

const pendingOpens: string[] = [];
let rendererListening = false;

/** Whether `arg` names a package file (a command-line argument, an Open With path). */
export function isSecurePackagePath(arg: string | undefined): arg is string {
  return typeof arg === 'string' && arg.toLowerCase().endsWith(PACKAGE_EXTENSION) && !arg.startsWith('-');
}

export function findSecurePackageArg(argv: readonly string[]): string | undefined {
  return argv.slice(1).find((arg) => isSecurePackagePath(arg));
}

/**
 * Hand a package path to the UI: straight away when a renderer has already
 * collected its backlog, otherwise kept until it does.
 */
export function enqueueSecurePackageOpen(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (rendererListening) {
    ipcBridge.secureExport.openRequested.emit({ path: resolved });
    return;
  }
  if (!pendingOpens.includes(resolved)) pendingOpens.push(resolved);
}

export function initSecureExportBridge(): void {
  ipcBridge.secureExport.writeBinary.provider(async ({ path: target, base64 }) => {
    try {
      if (!path.isAbsolute(target)) return false;
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length > MAX_BINARY_BYTES) return false;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      return true;
    } catch (error) {
      console.error('[secureExport] write failed:', error instanceof Error ? error.message : error);
      return false;
    }
  });

  ipcBridge.secureExport.readBinary.provider(async ({ path: target }) => {
    try {
      if (!path.isAbsolute(target)) return null;
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size > MAX_BINARY_BYTES) return null;
      return (await fs.readFile(target)).toString('base64');
    } catch {
      return null;
    }
  });

  ipcBridge.secureExport.takePendingOpens.provider(() => {
    rendererListening = true;
    return pendingOpens.splice(0, pendingOpens.length);
  });
}
