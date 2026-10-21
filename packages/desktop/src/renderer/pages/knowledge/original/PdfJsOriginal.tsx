import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type Props = {
  title: string;
  load: () => Promise<Blob>;
  /** Blob URL of the already-downloaded original; avoids a second download through `load`. */
  url?: string;
};

// Renders the original PDF with pdf.js instead of the browser plugin, whose
// English chrome and raw loading percentage leaked into the product shell.
export default function PdfJsOriginal(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTask = useRef<{ cancel: () => void } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const userZoomed = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let disposed = false;
    documentRef.current = null;
    setStatus('loading');
    setError('');
    setPage(1);
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
      setNumPages(document.numPages);
      // Fit the first page to the available width.
      const first = await document.getPage(1);
      const viewport = first.getViewport({ scale: 1 });
      const available = (canvasRef.current?.parentElement?.clientWidth ?? 800) - 24;
      setScale(Math.max(0.4, Math.min(2.5, available / viewport.width)));
      if (!disposed) setStatus('ready');
      // The container can still be settling when the document opens (mount
      // animations); refit once it has a real width unless the user zoomed.
      setTimeout(() => {
        if (disposed || userZoomed.current || !canvasRef.current?.parentElement) return;
        const width = canvasRef.current.parentElement.clientWidth;
        if (width > 200) setScale(Math.max(0.4, Math.min(2.5, (width - 24) / viewport.width)));
      }, 400);
    })().catch((reason) => {
      if (!disposed) {
        setStatus('error');
        setError(String(reason));
      }
    });
    return () => {
      disposed = true;
      renderTask.current?.cancel();
      void documentRef.current?.destroy();
      documentRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const document = documentRef.current;
      const canvas = canvasRef.current;
      if (!document || !canvas || status !== 'ready') return;
      const pdfPage = await document.getPage(Math.min(page, numPages || 1));
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      renderTask.current?.cancel();
      const task = pdfPage.render({ canvas, canvasContext: context, viewport });
      renderTask.current = task;
      await task.promise.catch((reason: unknown) => {
        const name = (reason as { name?: string }).name;
        if (name !== 'RenderingCancelledException') throw reason;
      });
    })().catch((reason) => {
      if (!cancelled) {
        setStatus('error');
        setError(String(reason));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [page, scale, status, numPages]);

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
        <Button size='mini' disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ‹
        </Button>
        <span role='status'>
          {page} / {numPages || '…'}
        </span>
        <Button size='mini' disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))}>
          ›
        </Button>
        <span style={{ flex: 1 }} />
        <Button
          size='mini'
          disabled={scale <= 0.4}
          onClick={() => {
            userZoomed.current = true;
            setScale((s) => Math.max(0.4, s - 0.2));
          }}
        >
          −
        </Button>
        <span>{Math.round(scale * 100)}%</span>
        <Button
          size='mini'
          disabled={scale >= 2.5}
          onClick={() => {
            userZoomed.current = true;
            setScale((s) => Math.min(2.5, s + 0.2));
          }}
        >
          +
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-fill-2, #f2f3f5)', padding: 12 }}>
        {status === 'loading' && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Spin tip={props.title} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <canvas
            ref={canvasRef}
            style={{
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              visibility: status === 'ready' ? 'visible' : 'hidden',
            }}
          />
        </div>
      </div>
    </div>
  );
}
