/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ASSISTANTS_LIST_SWR_KEY } from '@/renderer/hooks/assistant/useAssistantList';
import { preload } from 'swr';

let prefetchStarted = false;

/**
 * Warm the shared `assistants.list` SWR cache after the shell is ready.
 * Fire-and-forget, idempotent, and scheduled on idle time so it does not
 * compete with first paint or config bootstrap.
 */
export function prefetchAssistantsList(): void {
  if (prefetchStarted) {
    return;
  }
  prefetchStarted = true;

  const run = (): void => {
    void preload(ASSISTANTS_LIST_SWR_KEY, () => ipcBridge.assistants.list.invoke()).catch(() => {
      // Transient backend races should not poison the cache; allow a later hook fetch.
      prefetchStarted = false;
    });
  };

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2000 });
    return;
  }

  setTimeout(run, 0);
}
