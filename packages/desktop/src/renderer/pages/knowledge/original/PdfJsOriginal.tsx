import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spin, Tooltip } from '@arco-design/web-react';
import { AutoWidth, Left, Right, ZoomIn, ZoomOut } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

type Props = {
  title: string;
  load: () => Promise<Blob>;
  /** Blob URL of the already-downloaded original; avoids a second download through `load`. */
  url?: string;
};

type PageSize = { width: number; height: number };

const GAP = 12;
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.25;
/** Pages rendered beyond the visible ones, in each direction. Everything further away is released. */
const PREFETCH_PAGES = 1;
const KEEP_PAGES = 3;
/** Backing-store cap per page (≈ pdf.js' own default); beyond it the bitmap is stretched instead of growing. */
const MAX_CANVAS_PIXELS = 1 << 24;
const MAX_CANVAS_SIDE = 16384;

/** Top offset of every page (CSS px) and the total height of the scrolled column. */
export function pdfPageLayout(sizes: PageSize[], scale: number): { tops: number[]; total: number } {
  const tops: number[] = [];
  let y = GAP;
  for (const size of sizes) {
    tops.push(y);
    y += Math.floor(size.height * scale) + GAP;
  }
  return { tops, total: y };
}

/** Pages (0-based, inclusive) whose box intersects [from, to]. */
export function pagesInRange(tops: number[], heights: number[], from: number, to: number): [number, number] {
  let first = tops.findIndex((top, index) => top + heights[index] >= from);
  if (first < 0) first = tops.length - 1;
  let last = first;
  while (last + 1 < tops.length && tops[last + 1] <= to) last++;
  return [first, last];
}

/** Device pixels per CSS pixel for a page, capped so huge pages (posters, network diagrams) stay renderable. */
export function renderRatio(width: number, height: number, devicePixelRatio: number): number {
  const area = width * height;
  const byArea = area > 0 ? Math.sqrt(MAX_CANVAS_PIXELS / area) : devicePixelRatio;
  const bySide = MAX_CANVAS_SIDE / Math.max(width, height, 1);
  return Math.max(0.05, Math.min(devicePixelRatio, byArea, bySide));
}

const clampScale = (value: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));

// Renders the original PDF with pdf.js instead of the browser plugin, whose English chrome and raw loading
// percentage leaked into the product shell. Pages scroll continuously; only those near the viewport hold a
// canvas, so a long or poster-sized document costs the same as a short one.
export default function PdfJsOriginal(props: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  /** Scale each page's canvas currently shows; absent = blank. */
  const rendered = useRef(new Map<number, number>());
  const tasks = useRef(new Map<number, { scale: number; task?: RenderTask; cancelled: boolean }>());
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [scale, setScale] = useState(1);
  const [page, setPage] = useState(1);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const userZoomed = useRef(false);
  /**
   * The document point under the cursor (or the pane centre) when a zoom started, kept under the same screen
   * point afterwards: page + fraction of its height vertically, distance from the column centre horizontally.
   */
  const zoomAnchor = useRef<{
    index: number;
    fraction: number;
    fromCentre: number;
    scale: number;
    x: number;
    y: number;
  } | null>(null);
  /** Scale most recently requested; wheel events can arrive faster than React commits. */
  const targetScale = useRef(1);
  const latest = useRef(props);
  latest.current = props;

  const { tops, total } = useMemo(() => pdfPageLayout(sizes, scale), [sizes, scale]);
  const heights = useMemo(() => sizes.map((size) => Math.floor(size.height * scale)), [sizes, scale]);
  const widest = useMemo(() => Math.max(1, ...sizes.map((size) => size.width)), [sizes]);
  const contentWidth = Math.floor(widest * scale) + 2 * GAP;
  const layout = useRef({ tops, heights, scale, contentWidth });
  layout.current = { tops, heights, scale, contentWidth };

  const fitWidth = useCallback(() => {
    const width = scrollRef.current?.clientWidth ?? 0;
    if (width > 200 && widest > 1) setScale(clampScale((width - 2 * GAP) / widest));
  }, [widest]);

  useEffect(() => {
    let disposed = false;
    const pageCanvases = canvases.current;
    const pageTasks = tasks.current;
    documentRef.current = null;
    setStatus('loading');
    setError('');
    (async () => {
      // pdf.js 5.x relies on Map.getOrInsertComputed, which ships in newer V8
      // than the Electron build's renderer provides.
      const mapProto = Map.prototype as unknown as Record<string, unknown>;
      if (!mapProto.getOrInsertComputed) {
        mapProto.getOrInsertComputed = function getOrInsertComputed(
          this: Map<unknown, unknown>,
          key: unknown,
          callback: (key: unknown) => unknown
        ) {
          if (!this.has(key)) this.set(key, callback(key));
          return this.get(key);
        };
      }
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      const { PdfBinaryData } = await import('./pdfResources');
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      GlobalWorkerOptions.workerSrc = worker;
      // The viewer has already downloaded the original into a blob URL; read that instead of downloading again.
      const bytes = latest.current.url
        ? await (await fetch(latest.current.url)).arrayBuffer()
        : await (await latest.current.load()).arrayBuffer();
      const task = getDocument({
        data: new Uint8Array(bytes),
        useWorkerFetch: false,
        useWasm: false,
        BinaryDataFactory: PdfBinaryData,
      });
      const document = await task.promise;
      if (disposed) {
        void document.destroy();
        return;
      }
      documentRef.current = document;
      // Lay every page out at the first page's size; each is corrected when it is first rendered.
      const first = (await document.getPage(1)).getViewport({ scale: 1 });
      const size = { width: first.width, height: first.height };
      if (disposed) return;
      setSizes(Array.from({ length: document.numPages }, () => size));
      const available = (scrollRef.current?.clientWidth ?? 800) - 2 * GAP;
      setScale(clampScale(available / size.width));
      setStatus('ready');
    })().catch((reason) => {
      if (!disposed) {
        setStatus('error');
        setError(String(reason));
      }
    });
    return () => {
      disposed = true;
      for (const entry of pageTasks.values()) {
        entry.cancelled = true;
        entry.task?.cancel();
      }
      pageTasks.clear();
      pageCanvases.clear();
      rendered.current.clear();
      void documentRef.current?.destroy();
      documentRef.current = null;
    };
  }, []);

  // Keep the fit-to-width scale while the pane settles or is resized, until the user picks a zoom.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || status !== 'ready' || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!userZoomed.current) fitWidth();
      setViewport({ top: element.scrollTop, height: element.clientHeight });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [status, fitWidth]);

  /**
   * Zoom to `next`, keeping the document point at (x, y) — pane-relative pixels — where it is on screen.
   * Without a point the pane centre is kept.
   */
  const zoomTo = useCallback((next: number, x?: number, y?: number) => {
    const element = scrollRef.current;
    const clamped = clampScale(next);
    userZoomed.current = true;
    if (element && !zoomAnchor.current && layout.current.tops.length) {
      // Anchor against the committed layout; further wheel ticks before the next commit only move the target.
      const { tops: pageTops, heights: pageHeights, scale: current, contentWidth: width } = layout.current;
      const px = x ?? element.clientWidth / 2;
      const py = y ?? element.clientHeight / 2;
      const contentY = element.scrollTop + py;
      const [index] = pagesInRange(pageTops, pageHeights, contentY, contentY);
      zoomAnchor.current = {
        index,
        fraction: pageHeights[index] ? (contentY - pageTops[index]) / pageHeights[index] : 0,
        fromCentre: element.scrollLeft + px - Math.max(width, element.clientWidth) / 2,
        scale: current,
        x: px,
        y: py,
      };
    }
    targetScale.current = clamped;
    setScale(clamped);
  }, []);

  // Put the anchored point back under the cursor once every page has its new size.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const element = scrollRef.current;
    zoomAnchor.current = null;
    targetScale.current = scale;
    if (!anchor || !element || tops[anchor.index] === undefined) return;
    element.scrollTop = tops[anchor.index] + anchor.fraction * heights[anchor.index] - anchor.y;
    element.scrollLeft =
      Math.max(contentWidth, element.clientWidth) / 2 + (anchor.fromCentre * scale) / anchor.scale - anchor.x;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/⌘ + wheel (and a touchpad pinch, which Chromium reports the same way) zooms around the cursor
  // instead of zooming the whole application.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      // One mouse-wheel notch (deltaY ≈ 100) ≈ ×1.22; pinch gestures send many small deltas.
      const factor = Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) / 500);
      zoomTo(targetScale.current * factor, event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // Press and drag pans the page in both directions, like a hand tool.
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element || event.button !== 0 || event.pointerType === 'touch') return;
    // Leave clicks on the scrollbars to the scrollbars.
    const box = element.getBoundingClientRect();
    if (event.clientX - box.left >= element.clientWidth || event.clientY - box.top >= element.clientHeight) return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    element.setPointerCapture?.(event.pointerId);
    setDragging(true);
    event.preventDefault();
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    const start = drag.current;
    if (!element || !start || start.id !== event.pointerId) return;
    element.scrollLeft = start.left - (event.clientX - start.x);
    element.scrollTop = start.top - (event.clientY - start.y);
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    scrollRef.current?.releasePointerCapture?.(event.pointerId);
    setDragging(false);
  };

  const renderPage = useCallback(async (index: number, pageScale: number) => {
    const document = documentRef.current;
    const canvas = canvases.current.get(index);
    if (!document || !canvas) return;
    const entry: { scale: number; task?: RenderTask; cancelled: boolean } = {
      scale: pageScale,
      cancelled: false,
    };
    tasks.current.get(index)?.task?.cancel();
    tasks.current.set(index, entry);
    try {
      const pdfPage = await document.getPage(index + 1);
      if (entry.cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      setSizes((current) =>
        current[index] && (current[index].width !== natural.width || current[index].height !== natural.height)
          ? current.map((size, at) => (at === index ? { width: natural.width, height: natural.height } : size))
          : current
      );
      const pageViewport = pdfPage.getViewport({ scale: pageScale });
      const ratio = renderRatio(pageViewport.width, pageViewport.height, window.devicePixelRatio || 1);
      // Render off-screen and copy, so the stretched old bitmap stays visible until the sharp one is ready.
      const buffer = window.document.createElement('canvas');
      buffer.width = Math.max(1, Math.floor(pageViewport.width * ratio));
      buffer.height = Math.max(1, Math.floor(pageViewport.height * ratio));
      const context = buffer.getContext('2d');
      if (!context) return;
      entry.task = pdfPage.render({
        canvas: buffer,
        canvasContext: context,
        viewport: pageViewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await entry.task.promise;
      const target = canvases.current.get(index);
      if (entry.cancelled || !target) return;
      target.width = buffer.width;
      target.height = buffer.height;
      target.getContext('2d')?.drawImage(buffer, 0, 0);
      buffer.width = 0;
      rendered.current.set(index, pageScale);
    } catch (reason) {
      if ((reason as { name?: string }).name !== 'RenderingCancelledException') {
        console.warn('[pdf] page render failed', index + 1, reason);
      }
    } finally {
      if (tasks.current.get(index) === entry) tasks.current.delete(index);
    }
  }, []);

  // Render what is on (or next to) the screen at the current scale; release canvases far away.
  useEffect(() => {
    if (status !== 'ready' || !tops.length) return;
    const span = Math.max(viewport.height, 600);
    const [first, last] = pagesInRange(tops, heights, viewport.top, viewport.top + span);
    setPage(pagesInRange(tops, heights, viewport.top + span / 3, viewport.top + span / 3)[0] + 1);
    const from = Math.max(0, first - PREFETCH_PAGES);
    const to = Math.min(tops.length - 1, last + PREFETCH_PAGES);
    for (let index = from; index <= to; index++) {
      const pending = tasks.current.get(index);
      if (rendered.current.get(index) === scale || pending?.scale === scale) continue;
      void renderPage(index, scale);
    }
    for (const index of [...rendered.current.keys(), ...tasks.current.keys()]) {
      if (index >= first - KEEP_PAGES && index <= last + KEEP_PAGES) continue;
      const pending = tasks.current.get(index);
      if (pending) {
        pending.cancelled = true;
        pending.task?.cancel();
        tasks.current.delete(index);
      }
      const canvas = canvases.current.get(index);
      if (canvas) canvas.width = canvas.height = 0;
      rendered.current.delete(index);
    }
  }, [status, tops, heights, viewport, scale, renderPage]);

  const goTo = (target: number) => {
    const element = scrollRef.current;
    const index = Math.max(0, Math.min(tops.length - 1, target - 1));
    if (!element || tops[index] === undefined) return;
    element.scrollTop = tops[index] - GAP;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
  };

  if (status === 'error') {
    return <Alert type='error' content={error || props.title} style={{ margin: 16 }} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 12px',
          borderBottom: '1px solid var(--color-border, #e5e6eb)',
        }}
      >
        <Button
          size='mini'
          icon={<Left />}
          aria-label={t('common.knowledgeLibrary.pdfPreviousPage')}
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
        />
        <span role='status'>
          {page} / {sizes.length || '…'}
        </span>
        <Button
          size='mini'
          icon={<Right />}
          aria-label={t('common.knowledgeLibrary.pdfNextPage')}
          disabled={page >= sizes.length}
          onClick={() => goTo(page + 1)}
        />
        <span style={{ flex: 1 }} />
        <Tooltip content={t('common.knowledgeLibrary.pdfFitWidth')}>
          <Button
            size='mini'
            icon={<AutoWidth />}
            aria-label={t('common.knowledgeLibrary.pdfFitWidth')}
            onClick={() => {
              userZoomed.current = false;
              fitWidth();
            }}
          />
        </Tooltip>
        <Button
          size='mini'
          icon={<ZoomOut />}
          aria-label={t('common.knowledgeLibrary.pdfZoomOut')}
          disabled={scale <= MIN_SCALE}
          onClick={() => zoomTo(scale / ZOOM_STEP)}
        />
        <span style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
        <Button
          size='mini'
          icon={<ZoomIn />}
          aria-label={t('common.knowledgeLibrary.pdfZoomIn')}
          disabled={scale >= MAX_SCALE}
          onClick={() => zoomTo(scale * ZOOM_STEP)}
        />
      </div>
      <div
        ref={scrollRef}
        data-testid='pdf-scroll'
        onScroll={(event) =>
          setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--color-fill-2, #f2f3f5)',
          position: 'relative',
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
      >
        {status === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin tip={props.title} />
          </div>
        )}
        {/* Sized to the widest page so a zoomed page scrolls horizontally instead of being clipped on the left. */}
        <div
          style={{
            position: 'relative',
            height: total,
            width: Math.floor(widest * scale) + 2 * GAP,
            minWidth: '100%',
          }}
        >
          {sizes.map((size, index) => (
            <canvas
              key={index}
              ref={(element) => {
                if (element) canvases.current.set(index, element);
                else canvases.current.delete(index);
              }}
              data-page={index + 1}
              style={{
                position: 'absolute',
                top: tops[index],
                left: '50%',
                transform: 'translateX(-50%)',
                width: Math.floor(size.width * scale),
                height: heights[index],
                background: '#fff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
