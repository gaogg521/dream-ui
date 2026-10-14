import React, { useEffect, useRef } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CsvDocument from './CsvDocument';
import styles from './KnowledgeLibrary.module.css';

type Props = {
  title: string;
  location?: string;
  content: string;
  mimeType?: string | null;
  reading: boolean;
  canEdit: boolean;
  loading?: boolean;
  saving?: boolean;
  onReading: (value: boolean) => void;
  onChange: (value: string) => void;
  onBack: () => void;
  onSave: () => void;
};

export default function LibraryDocument(props: Props) {
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let parent = pageRef.current?.parentElement;
    while (parent) {
      if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) parent.scrollTop = 0;
      parent = parent.parentElement;
    }
  }, [props.title]);
  const { t } = useTranslation();
  const csv = props.mimeType === 'text/csv' || /\.csv$/i.test(props.title);
  const html = props.mimeType === 'text/html' || /\.html?$/i.test(props.title);
  return (
    <section ref={pageRef} className={styles.documentPage} aria-label={props.title} data-testid='knowledge-document'>
      <header className={styles.documentBar}>
        <Button type='text' onClick={props.onBack} disabled={props.saving}>
          {t('common.knowledgeLibrary.backToLibrary')}
        </Button>
        <div className={styles.documentIdentity}>
          <strong title={props.title}>{props.title}</strong>
          <span title={props.location}>{props.location}</span>
        </div>
        <div className={styles.documentCommands}>
          <Button
            type={props.reading ? 'secondary' : 'text'}
            onClick={() => props.onReading(true)}
            disabled={props.saving}
          >
            {t('common.knowledgeLibrary.read')}
          </Button>
          {props.canEdit && (
            <Button
              type={!props.reading ? 'secondary' : 'text'}
              onClick={() => props.onReading(false)}
              disabled={props.loading || props.saving}
            >
              {t('common.edit')}
            </Button>
          )}
          {!props.reading && props.canEdit && (
            <Button type='primary' onClick={props.onSave} loading={props.saving} disabled={props.loading}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </header>
      <div className={styles.documentCanvas}>
        {props.loading ? (
          <div className={styles.documentPaper}>{t('common.loading')}</div>
        ) : props.reading ? (
          html ? (
            <iframe title={props.title} sandbox='' srcDoc={props.content} className={styles.htmlPreview} />
          ) : (
            <article className={styles.documentPaper}>
              {csv ? (
                <CsvDocument value={props.content} readOnly />
              ) : (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.content}</ReactMarkdown>
              )}
            </article>
          )
        ) : (
          <div className={styles.documentPaper}>
            {csv ? (
              <CsvDocument value={props.content} onChange={props.onChange} readOnly={props.saving} />
            ) : (
              <Input.TextArea
                aria-label={t('common.knowledgeLibrary.documentContent')}
                value={props.content}
                onChange={props.onChange}
                className={styles.documentEditor}
                disabled={props.saving}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
