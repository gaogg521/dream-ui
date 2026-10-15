import React, { useEffect, useRef, useState } from 'react';
import { Alert, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { init } from 'pptx-preview';
import styles from '../KnowledgeLibrary.module.css';

export default function SlidesOriginal({ url, title }: { url: string; title: string }) {
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
    document.body.replaceChildren();
    const container = document.createElement('div');
    document.body.append(container);
    const viewer = init(container, { width: 960, mode: 'list' });
    const resize = () => {
      document.body.style.zoom = String(Math.min(1, document.documentElement.clientWidth / 960));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    setLoading(true);
    setError(false);
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      })
      .then(async (data) => {
        if (!active) return;
        await viewer.preview(data);
        if (!active) return;
        resize();
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setError(true);
        }
      });
    return () => {
      active = false;
      controller.abort();
      observer.disconnect();
      viewer.destroy();
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
          '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; font-src data: blob:; style-src \'unsafe-inline\'"><style>body{margin:0;background:#eef0f3}a{pointer-events:none}</style></head><body></body></html>'
        }
        onLoad={() => setReady((value) => value + 1)}
        className={styles.originalFrame}
      />
    </>
  );
}
