import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { sourceKind } from './sourceKind';
import styles from '../KnowledgeLibrary.module.css';
const WordOriginal = lazy(() => import('./WordOriginal'));
const SlidesOriginal = lazy(() => import('./SlidesOriginal'));
const SheetsOriginal = lazy(() => import('./SheetsOriginal'));
const HtmlOriginal = lazy(() => import('./HtmlOriginal'));
const PdfJsOriginal = lazy(() => import('./PdfJsOriginal'));

type Props = {
  id: string;
  title: string;
  mime: string;
  load: () => Promise<Blob>;
  uploadOriginal?: (file: File) => Promise<unknown>;
  startEditing?: boolean;
  onSaved?: () => Promise<void> | void;
};
export default function OriginalFileViewer({ id, title, mime, load, uploadOriginal, startEditing, onSaved }: Props) {
  const { t } = useTranslation();
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError(false);
    void latestLoad
      .current()
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, mime, attempt]);
  if (error)
    return (
      <Alert
        type='error'
        content={
          <>
            {t('common.knowledgeLibrary.originalLoadFailed')}
            <Button onClick={() => setAttempt((value) => value + 1)}>
              {t('common.knowledgeLibrary.retryOriginal')}
            </Button>
          </>
        }
      />
    );
  if (!url) return <Spin tip={t('common.loading')} />;
  const kind = sourceKind(mime, title);
  return (
    <div className={styles.originalViewer}>
      {kind === 'pdf' ? (
        <Suspense fallback={<Spin tip={t('common.loading')} />}>
          <PdfJsOriginal title={title} load={load} />
        </Suspense>
      ) : kind === 'word' ? (
        <Suspense fallback={<Spin tip={t('common.loading')} />}>
          <WordOriginal url={url} title={title} />
        </Suspense>
      ) : kind === 'slides' ? (
        <Suspense fallback={<Spin tip={t('common.loading')} />}>
          <SlidesOriginal url={url} title={title} />
        </Suspense>
      ) : kind === 'sheets' ? (
        <Suspense fallback={<Spin tip={t('common.loading')} />}>
          <SheetsOriginal url={url} title={title} uploadOriginal={uploadOriginal} startEditing={startEditing} onSaved={onSaved} />
        </Suspense>
      ) : kind === 'image' ? (
        <img alt={title} src={url} className={styles.originalImage} />
      ) : kind === 'video' ? (
        <video aria-label={title} controls preload='metadata' src={url} className={styles.originalMedia} />
      ) : kind === 'audio' ? (
        <audio aria-label={title} controls preload='metadata' src={url} />
      ) : kind === 'html' ? (
        <Suspense fallback={<Spin tip={t('common.loading')} />}>
          <HtmlOriginal url={url} title={title} />
        </Suspense>
      ) : (
        <Alert type='info' content={t('common.knowledgeLibrary.originalUnsupported')} />
      )}
      <a href={url} download={title} className={styles.originalDownload}>
        {t('common.knowledgeLibrary.downloadOriginal')}
      </a>
    </div>
  );
}
