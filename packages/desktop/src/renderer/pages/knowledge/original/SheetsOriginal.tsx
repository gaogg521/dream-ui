import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { read, utils, type WorkBook } from 'xlsx-republish';
import styles from '../KnowledgeLibrary.module.css';

export default function SheetsOriginal({ url, title }: { url: string; title: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ url: string; book: WorkBook } | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.arrayBuffer();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const book = read(data, { cellHTML: false, sheetRows: 2000 });
        setLoaded({ url, book });
        setSelected(book.SheetNames[0] ?? '');
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [url]);
  const preview = useMemo(() => {
    if (!loaded || loaded.url !== url) return null;
    const source = loaded.book.Sheets[selected];
    if (!source) return null;
    const sheet = { ...source };
    const range = utils.decode_range(sheet['!ref'] || 'A1');
    range.e.r = Math.min(range.e.r, range.s.r + 1999);
    range.e.c = Math.min(range.e.c, range.s.c + 99);
    sheet['!ref'] = utils.encode_range(range);
    const header =
      "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'\"><style>body{font:14px system-ui;margin:0;padding:16px;color:#263244}table{border-collapse:collapse;white-space:pre-wrap}td{border:1px solid #dce1e9;padding:9px 14px;min-width:90px;max-width:400px;overflow-wrap:anywhere}tr:first-child{background:#f3f5fa;font-weight:600}a{pointer-events:none;color:inherit}</style></head><body>";
    return utils.sheet_to_html(sheet, { header, footer: '</body></html>' });
  }, [loaded, selected, url]);
  if (error) return <Alert type='error' content={t('common.knowledgeLibrary.originalLoadFailed')} />;
  if (!loaded || loaded.url !== url) return <Spin tip={t('common.loading')} />;
  return (
    <>
      <div role='tablist' style={{ display: 'flex', gap: 8, maxWidth: '100%', overflowX: 'auto', padding: 8 }}>
        {loaded.book.SheetNames.map((name) => (
          <Button
            key={name}
            role='tab'
            aria-selected={name === selected}
            type={name === selected ? 'secondary' : 'text'}
            onClick={() => setSelected(name)}
          >
            {name}
          </Button>
        ))}
      </div>
      <Alert type='info' content={t('common.knowledgeLibrary.sheetPreviewNote')} />
      <iframe title={title} sandbox='' srcDoc={preview ?? ''} className={styles.originalFrame} />
    </>
  );
}
