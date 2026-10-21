/** @vitest-environment jsdom */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getDocument = vi.hoisted(() =>
  vi.fn((_options: { data: Uint8Array }) => ({
    promise: Promise.resolve({
      numPages: 1,
      destroy: vi.fn(),
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
  }))
);
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));
vi.mock('@/renderer/pages/knowledge/original/pdfResources', () => ({ PdfBinaryData: class {} }));

import PdfJsOriginal from '@/renderer/pages/knowledge/original/PdfJsOriginal';

afterEach(() => vi.unstubAllGlobals());

describe('PdfJsOriginal', () => {
  it('reads the already-downloaded blob URL instead of downloading the original a second time', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const fetchSpy = vi.fn(async () => new Response(bytes));
    vi.stubGlobal('fetch', fetchSpy);
    const load = vi.fn(async () => new Blob([bytes]));

    render(<PdfJsOriginal title='Guide.pdf' load={load} url='blob:local/guide' />);

    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith('blob:local/guide');
    expect(load).not.toHaveBeenCalled();
    expect(Array.from(getDocument.mock.calls[0][0].data)).toEqual([37, 80, 68, 70]);
  });

  it('falls back to downloading through load when no blob URL is supplied', async () => {
    const load = vi.fn(async () => new Blob([new Uint8Array([1, 2])]));
    render(<PdfJsOriginal title='Guide.pdf' load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });
});
