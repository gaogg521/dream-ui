import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { sourceKind } from './sourceKind';
import styles from '../KnowledgeLibrary.module.css';

type Props = { id: string; title: string; mime: string; load: () => Promise<Blob> };
export default function OriginalFileViewer({ id, title, mime, load }: Props) {
  const { t } = useTranslation();
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError('');
    void latestLoad
      .current()
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setError(t('common.knowledgeLibrary.originalLoadFailed'));
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, mime, attempt, t]);
  if (error)
    return (
      <Alert
        type='error'
        content={
          <>
            {error}
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
        <iframe title={title} src={`${url}#toolbar=1&navpanes=1`} className={styles.originalFrame} />
      ) : kind === 'image' ? (
        <img alt={title} src={url} className={styles.originalImage} />
      ) : kind === 'video' ? (
        <video aria-label={title} controls preload='metadata' src={url} className={styles.originalMedia} />
      ) : kind === 'audio' ? (
        <audio aria-label={title} controls preload='metadata' src={url} />
      ) : kind === 'html' ? (
        <iframe title={title} src={url} sandbox='' className={styles.originalFrame} />
      ) : (
        <Alert type='info' content={t('common.knowledgeLibrary.originalUnsupported')} />
      )}
      <a href={url} download={title} className={styles.originalDownload}>
        {t('common.knowledgeLibrary.downloadOriginal')}
      </a>
    </div>
  );
}
