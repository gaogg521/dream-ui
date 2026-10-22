/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const renderCalls = vi.hoisted(() => [] as Array<{ page: number; scale: number; transform?: number[] }>);
const getDocument = vi.hoisted(() =>
  vi.fn((_options: { data: Uint8Array }) => ({
    promise: Promise.resolve({
      numPages: 40,
      destroy: vi.fn(),
      getPage: async (page: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: (params: { viewport: { width: number }; transform?: number[] }) => {
          renderCalls.push({ page, scale: params.viewport.width / 600, transform: params.transform });
          return { promise: Promise.resolve(), cancel: vi.fn() };
        },
      }),
    }),
  }))
);
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));
vi.mock('@/renderer/pages/knowledge/original/pdfResources', () => ({ PdfBinaryData: class {} }));

import PdfJsOriginal, {
  pagesInRange,
  pdfPageLayout,
  renderRatio,
} from '@/renderer/pages/knowledge/original/PdfJsOriginal';

// jsdom has no canvas backend; pdf.js itself is mocked, the viewer only needs a context to copy into.
// jsdom has no layout either: give the scroll pane the size of a real reading pane.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  renderCalls.length = 0;
});

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

  it('lays out every page but renders only the ones near the viewport', async () => {
    const load = vi.fn(async () => new Blob([new Uint8Array([1])]));
    const { container } = render(<PdfJsOriginal title='Long.pdf' load={load} />);
    await waitFor(() => expect(container.querySelectorAll('canvas')).toHaveLength(40));
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(0));
    const pages = new Set(renderCalls.map((call) => call.page));
    expect(Math.max(...pages)).toBeLessThan(6);
    expect(screen.getByRole('status').textContent).toBe('1 / 40');
  });

  it('zooms in multiplicative steps instead of a fixed 0.2 that overshoots small fit scales', async () => {
    const load = vi.fn(async () => new Blob([new Uint8Array([1])]));
    render(<PdfJsOriginal title='Zoom.pdf' load={load} />);
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(0));
    const before = Number(screen.getByText(/%$/).textContent!.replace('%', ''));
    fireEvent.click(screen.getByLabelText('common.knowledgeLibrary.pdfZoomIn'));
    const after = Number(screen.getByText(/%$/).textContent!.replace('%', ''));
    expect(after / before).toBeCloseTo(1.25, 1);
  });
});

describe('PdfJsOriginal pointer gestures', () => {
  it('pans the page in both directions while the mouse is dragged', async () => {
    const load = vi.fn(async () => new Blob([new Uint8Array([1])]));
    render(<PdfJsOriginal title='Pan.pdf' load={load} />);
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(0));
    const pane = screen.getByTestId('pdf-scroll');
    pane.scrollLeft = 300;
    pane.scrollTop = 500;
    fireEvent.pointerDown(pane, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 });
    fireEvent.pointerMove(pane, { pointerId: 1, clientX: 40, clientY: 160 });
    expect(pane.scrollLeft).toBe(360);
    expect(pane.scrollTop).toBe(440);
    fireEvent.pointerUp(pane, { pointerId: 1 });
    fireEvent.pointerMove(pane, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(pane.scrollLeft).toBe(360);
  });

  it('zooms with Ctrl + wheel and leaves a plain wheel to scrolling', async () => {
    const load = vi.fn(async () => new Blob([new Uint8Array([1])]));
    render(<PdfJsOriginal title='Wheel.pdf' load={load} />);
    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(0));
    const pane = screen.getByTestId('pdf-scroll');
    const percent = () => Number(screen.getByText(/%$/).textContent!.replace('%', ''));
    const before = percent();
    fireEvent.wheel(pane, { deltaY: 100 });
    expect(percent()).toBe(before);
    fireEvent.wheel(pane, { deltaY: -100, ctrlKey: true, clientX: 200, clientY: 200 });
    await waitFor(() => expect(percent()).toBeGreaterThan(before));
  });
});

describe('pdf layout helpers', () => {
  it('stacks pages with gaps and finds the visible range', () => {
    const { tops, total } = pdfPageLayout(
      [
        { width: 100, height: 100 },
        { width: 100, height: 200 },
        { width: 100, height: 100 },
      ],
      1
    );
    expect(tops).toEqual([12, 124, 336]);
    expect(total).toBe(448);
    expect(pagesInRange(tops, [100, 200, 100], 0, 50)).toEqual([0, 0]);
    expect(pagesInRange(tops, [100, 200, 100], 150, 340)).toEqual([1, 2]);
    expect(pagesInRange(tops, [100, 200, 100], 10_000, 10_100)).toEqual([2, 2]);
  });

  it('caps the backing store of poster-sized pages instead of allocating a giant canvas', () => {
    expect(renderRatio(800, 1000, 2)).toBe(2);
    // A 5893×1786 pt network diagram at 250%: full DPR would be ~165M device pixels.
    const ratio = renderRatio(5893 * 2.5, 1786 * 2.5, 1.25);
    expect(5893 * 2.5 * ratio * 1786 * 2.5 * ratio).toBeLessThanOrEqual(1 << 24);
    expect(5893 * 2.5 * ratio).toBeLessThanOrEqual(16384);
  });
});
