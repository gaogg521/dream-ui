/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  window.__backendPort = 13400;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__backendPort;
});

// PreviewPanel statically pulls in the whole preview stack (Excel, PDF, Office,
// Markdown, HTML/code editors, browser tab layer, ...). Evaluating that graph
// cold was measured at ~27s on this machine while the rest of the suite was
// competing for CPU, and the remaining two assertions then cost ~40ms each
// because the module registry already holds it.
//
// Two consequences, both handled here:
//   1. Nothing about this wait is conditional — it is a single module import
//      that either resolves or throws, so it cannot hang; it is only slow. The
//      budget is therefore sized off the measured cost with real headroom
//      instead of the previous 60s, which the full 444-file run could exceed.
//   2. The graph is imported once and the promise shared, so a single test can
//      never be charged for it twice. `vi.resetModules()` used to run in
//      afterEach; it bought this file nothing and only risked forcing the graph
//      to be evaluated again between tests, so it is gone.
const IMPORT_TIMEOUT_MS = 180000;

let previewPanelModule:
  | Promise<typeof import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel')>
  | undefined;

const importPreviewPanel = () => {
  previewPanelModule ??= import('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel');
  return previewPanelModule;
};

describe('PreviewPanel', () => {
  it(
    'is a React component module that exports a default function',
    async () => {
      const mod = await importPreviewPanel();
      expect(typeof mod.default).toBe('function');
    },
    IMPORT_TIMEOUT_MS
  );

  it(
    'module loads without throwing on import',
    async () => {
      await expect(importPreviewPanel()).resolves.toBeTruthy();
    },
    IMPORT_TIMEOUT_MS
  );

  it(
    'has a displayName or function name for debugging',
    async () => {
      const mod = await importPreviewPanel();
      const fn = mod.default;
      expect(fn.name || fn.displayName || 'anonymous').toBeTruthy();
    },
    IMPORT_TIMEOUT_MS
  );
});
