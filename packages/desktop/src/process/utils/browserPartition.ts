/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'fs';
import path from 'path';
import { app } from 'electron';
import { BROWSER_SESSION_PARTITION, LEGACY_BROWSER_SESSION_PARTITION } from '@/common/config/constants';

/** Electron stores `persist:foo` under `userData/Partitions/foo`. */
const partitionDir = (partition: string): string =>
  path.join(app.getPath('userData'), 'Partitions', partition.replace(/^persist:/, ''));

let resolved: string | null = null;

/**
 * Which embedded-browser session partition this install uses.
 *
 * A partition is not a label, it is the stored cookies and sign-in state. The
 * rebrand cannot simply rename it: pointing an existing install at the new name
 * does not migrate anything and does not fail either — Electron just opens an
 * empty profile, and the user finds themselves signed out of every site they had
 * logged into on the agent's behalf, with nothing to explain why.
 *
 * So the old profile keeps being used while its directory exists, and only a
 * fresh install gets the current name. Resolved once per process: the renderer
 * creates `<webview>` tags with whatever value this returns (through preload's
 * `__browserPartition`), and a value that changed mid-session would split the
 * browser's state across two profiles.
 */
export const resolveBrowserPartition = (): string => {
  if (resolved) return resolved;
  try {
    if (
      !existsSync(partitionDir(BROWSER_SESSION_PARTITION)) &&
      existsSync(partitionDir(LEGACY_BROWSER_SESSION_PARTITION))
    ) {
      resolved = LEGACY_BROWSER_SESSION_PARTITION;
      return resolved;
    }
  } catch {
    // Unreadable userData — fall through to the current name rather than failing
    // the browser outright.
  }
  resolved = BROWSER_SESSION_PARTITION;
  return resolved;
};
