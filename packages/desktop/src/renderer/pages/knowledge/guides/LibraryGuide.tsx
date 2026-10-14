import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import quickZh from './quickstart.zh-CN.md?raw';
import usageZh from './usage.zh-CN.md?raw';
import quickEn from './quickstart.en-US.md?raw';
import usageEn from './usage.en-US.md?raw';
import styles from '../KnowledgeLibrary.module.css';
export type GuideId = 'quickstart' | 'usage';
export default function LibraryGuide({ id, onClose }: { id: GuideId; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const chinese = i18n.language.startsWith('zh');
  const body = id === 'quickstart' ? (chinese ? quickZh : quickEn) : chinese ? usageZh : usageEn;
  return (
    <section className={styles.documentPage}>
      <header className={styles.documentBar}>
        <Button type='text' onClick={onClose}>
          {t('common.knowledgeLibrary.backToLibrary')}
        </Button>
      </header>
      <div className={styles.documentCanvas}>
        <article className={styles.documentPaper}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
      </div>
    </section>
  );
}
