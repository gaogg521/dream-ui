/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const writeRendererLogInvoke = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      getImageBase64: { invoke: vi.fn(() => Promise.resolve('')) },
      readFile: { invoke: vi.fn(() => Promise.resolve('')) },
    },
    application: {
      writeRendererLog: { invoke: writeRendererLogInvoke },
    },
  },
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid='monaco-editor'>{value}</div>,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    useMessage: () => [{ info: vi.fn(), success: vi.fn(), error: vi.fn() }, null],
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import HTMLViewer from '@/renderer/pages/conversation/Preview/components/viewers/HTMLViewer';
import HTMLRenderer from '@/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';

function createConsoleMessageEvent({
  level,
  line,
  message,
  sourceId,
}: {
  level: number;
  line: number;
  message: string;
  sourceId: string;
}): Event {
  const event = new Event('console-message');
  Object.defineProperties(event, {
    level: { value: level },
    line: { value: line },
    message: { value: message },
    sourceId: { value: sourceId },
  });
  return event;
}

describe('HTMLViewer', () => {
  it('renders iframe with HTML content', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
  });

  it('hides toolbar when hideToolbar is true', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' hideToolbar />);
    expect(container.querySelector('[class*="toolbar"]')).not.toBeInTheDocument();
  });

  it('accepts file_path prop', () => {
    const { container } = render(<HTMLViewer content='<h1>Test</h1>' file_path='/test/index.html' />);
    expect(container.querySelector('iframe')).toBeInTheDocument();
  });
});

describe('HTMLRenderer', () => {
  const electronAPI = {};

  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.clearAllMocks();
  });

  it('loads clean local HTML files through file URL in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const { container } = render(
      <HTMLRenderer
        content='<script src="https://cdn.example.com/app.js"></script><script>localStorage.getItem("theme")</script>'
        file_path='/workspace/financial-wechat-miniapp.html'
      />
    );

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toBe('file:///workspace/financial-wechat-miniapp.html');
  });

  it('keeps dirty local HTML content in memory in Electron', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const dirtyProps = {
      content: '<h1>Unsaved edit</h1>',
      file_path: '/workspace/index.html',
      isDirty: true,
    } as React.ComponentProps<typeof HTMLRenderer> & { isDirty: boolean };

    const { container } = render(<HTMLRenderer {...dirtyProps} />);

    const webview = container.querySelector('webview');
    expect(webview).toBeInTheDocument();
    expect(webview?.getAttribute('src')).toContain('data:text/html');
    expect(webview?.getAttribute('src')).toContain('Unsaved%20edit');
  });

  describe('pages too large for a data URL', () => {
    // Chromium rejects navigation to URLs over 2 MiB with ERR_INVALID_URL and the webview stays blank.
    const bigHtml = (chars: number) => `<!doctype html><title>big</title><script>/*${'x'.repeat(chars)}*/</script>`;

    it('loads a blank page and writes the content in by script once the webview is ready', async () => {
      Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI });
      const html = bigHtml(2_100_000);

      const { container } = render(<HTMLRenderer content={html} />);
      const webview = container.querySelector('webview') as (HTMLElement & { executeJavaScript?: unknown }) | null;
      expect(webview).toBeInTheDocument();

      const src = webview?.getAttribute('src') ?? '';
      expect(src).toContain('data:text/html');
      expect(src.length).toBeLessThan(2_000); // the tiny boot page, not the 2 MB document

      const executeJavaScript = vi.fn(() => Promise.resolve());
      Object.assign(webview as HTMLElement, { executeJavaScript });
      webview?.dispatchEvent(new Event('dom-ready'));

      await waitFor(() => expect(executeJavaScript).toHaveBeenCalled());
      const writes = (executeJavaScript.mock.calls as unknown as string[][])
        .map((call) => call[0])
        .filter((script) => script.startsWith('document.open()'));
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain('document.write(');
      expect(writes[0]).toContain('x'.repeat(1_000)); // the full document travels in the script
      expect(writes[0].endsWith('document.close();')).toBe(true);
    });

    it('keeps the plain data URL for content that still fits', () => {
      Object.defineProperty(window, 'electronAPI', { configurable: true, value: electronAPI });
      const html = bigHtml(1_500_000);

      const { container } = render(<HTMLRenderer content={html} />);
      const webview = container.querySelector('webview');

      const src = webview?.getAttribute('src') ?? '';
      expect(src.length).toBeGreaterThan(1_500_000);
      expect(src.length).toBeLessThanOrEqual(2_000_000);
    });
  });

  it('writes preview source selection to the renderer log bridge', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    render(<HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/financial-wechat-miniapp.html' />);

    await waitFor(() =>
      expect(writeRendererLogInvoke).toHaveBeenCalledWith({
        level: 'info',
        tag: 'HTMLRenderer',
        message: 'html_preview_source_selected',
        data: expect.objectContaining({
          source: 'file',
          reason: 'clean-local-file',
          fileName: 'financial-wechat-miniapp.html',
          hasFilePath: true,
          contentLength: 13,
          src: 'file://financial-wechat-miniapp.html',
        }),
      })
    );
  });

  it('writes level 2 preview console messages as renderer warnings', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: electronAPI,
    });

    const { container } = render(<HTMLRenderer content='<h1>Test</h1>' file_path='/workspace/index.html' />);
    const webview = container.querySelector('webview');

    await waitFor(() => expect(writeRendererLogInvoke).toHaveBeenCalled());
    vi.clearAllMocks();

    webview?.dispatchEvent(
      createConsoleMessageEvent({
        level: 2,
        line: 64,
        message: 'cdn.tailwindcss.com should not be used in production.',
        sourceId: 'https://cdn.tailwindcss.com/',
      })
    );

    await waitFor(() =>
      expect(writeRendererLogInvoke).toHaveBeenCalledWith({
        level: 'warn',
        tag: 'HTMLRenderer',
        message: 'html_preview_console_warning',
        data: {
          level: 2,
          line: 64,
          message: 'cdn.tailwindcss.com should not be used in production.',
          source: 'https://cdn.tailwindcss.com/',
        },
      })
    );
  });
});
