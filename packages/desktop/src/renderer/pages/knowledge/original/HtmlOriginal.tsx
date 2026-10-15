import React, { useEffect, useState } from 'react';
import { Alert, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import styles from '../KnowledgeLibrary.module.css';

const policy =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'\">";
export default function HtmlOriginal({ url, content, title }: { url?: string; content?: string; title: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ url: string; content: string } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setError(false);
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((value) => {
        if (!controller.signal.aborted) setLoaded({ url, content: value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [url]);
  if (error) return <Alert type='error' content={t('common.knowledgeLibrary.originalLoadFailed')} />;
  const html = content ?? (loaded && loaded.url === url ? loaded.content : undefined);
  if (html === undefined) return <Spin tip={t('common.loading')} />;
  return <iframe title={title} sandbox='allow-scripts' srcDoc={policy + html} className={styles.originalFrame} />;
}
