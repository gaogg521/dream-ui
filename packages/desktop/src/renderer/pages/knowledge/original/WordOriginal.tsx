import React, { useEffect, useRef, useState } from 'react';
import { Alert, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { renderAsync } from 'docx-preview';
import styles from '../KnowledgeLibrary.module.css';

/** Render locally in a script-free frame; document styles cannot affect the app. */
export default function WordOriginal({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = frame.current;
    const document = element?.contentDocument;
    if (!element || !document?.body || !ready) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const resize = () => {
      if (!active) return;
      const pages = Array.from(document.querySelectorAll<HTMLElement>('section.docx'));
      const width = Math.max(1, ...pages.map((page) => page.offsetWidth));
      document.body.style.zoom = String(Math.min(1, document.documentElement.clientWidth / (width + 60)));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      })
      .then(async (data) => {
        if (!active) return;
        await renderAsync(data, document.body, document.head, {
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          renderAltChunks: false,
          useBase64URL: true,
        });
        if (!active) return;
        resize();
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
      controller.abort();
      observer.disconnect();
    };
  }, [url, ready]);
  return (
    <>
      {loading && <Spin tip={t('common.loading')} />}
      {error && <Alert type='error' content={t('common.knowledgeLibrary.originalLoadFailed')} />}
      <iframe
        ref={frame}
        title={title}
        sandbox='allow-same-origin'
        srcDoc={
          '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; font-src data: blob:; style-src \'unsafe-inline\'"><style>body{margin:0;background:#eef0f3}a{pointer-events:none}</style></head><body></body></html>'
        }
        onLoad={() => setReady((value) => value + 1)}
        className={styles.originalFrame}
      />
    </>
  );
}
