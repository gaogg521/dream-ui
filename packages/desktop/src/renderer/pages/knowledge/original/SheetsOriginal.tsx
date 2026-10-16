import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { read, utils, write, type WorkBook } from 'xlsx-republish';
import styles from '../KnowledgeLibrary.module.css';

type Props = {
  url: string;
  title: string;
  uploadOriginal?: (file: File) => Promise<unknown>;
  startEditing?: boolean;
  onSaved?: () => Promise<void> | void;
};

// Online-editing window bounds keep the DOM table usable; the read-only
// preview keeps its own wider window.
const EDIT_ROWS = 200;
const EDIT_COLS = 26;

export default function SheetsOriginal({ url, title, uploadOriginal, startEditing, onSaved }: Props) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ url: string; book: WorkBook } | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const pendingSaved = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setEditing(false);
    setDirty(false);
    setSaved(false);
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
        if (startEditing) beginEdit(book, book.SheetNames[0] ?? '');
        if (pendingSaved.current) {
          pendingSaved.current = false;
          setSaved(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [url, reload]);
  const range = useMemo(() => {
    if (!loaded || loaded.url !== url) return null;
    const sheet = loaded.book.Sheets[selected];
    if (!sheet) return null;
    const decoded = utils.decode_range(sheet['!ref'] || 'A1');
    decoded.e.r = Math.min(decoded.e.r, decoded.s.r + 1999);
    decoded.e.c = Math.min(decoded.e.c, decoded.s.c + 99);
    return decoded;
  }, [loaded, selected, url]);
  const preview = useMemo(() => {
    if (!range || !loaded || loaded.url !== url) return null;
    const sheet = { ...loaded.book.Sheets[selected] };
    sheet['!ref'] = utils.encode_range(range);
    const header =
      "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'\"><style>body{font:14px system-ui;margin:0;padding:16px;color:#263244}table{border-collapse:collapse;white-space:pre-wrap}td{border:1px solid #dce1e9;padding:9px 14px;min-width:90px;max-width:400px;overflow-wrap:anywhere}tr:first-child{background:#f3f5fa;font-weight:600}a{pointer-events:none;color:inherit}</style></head><body>";
    return utils.sheet_to_html(sheet, { header, footer: '</body></html>' });
  }, [loaded, selected, url, range]);
  const beginEdit = (book: WorkBook, name: string) => {
    const sheet = book.Sheets[name];
    if (!sheet) return;
    const decoded = utils.decode_range(sheet['!ref'] || 'A1');
    const rows: string[][] = [];
    for (let r = 0; r < Math.min(EDIT_ROWS, decoded.e.r - decoded.s.r + 1); r++) {
      const row: string[] = [];
      for (let c = 0; c < Math.min(EDIT_COLS, decoded.e.c - decoded.s.c + 1); c++) {
        const cell = sheet[utils.encode_cell({ r: decoded.s.r + r, c: decoded.s.c + c })];
        row.push(cell ? utils.format_cell(cell) : '');
      }
      rows.push(row);
    }
    setDraft(rows);
    setSaved(false);
    setEditing(true);
  };
  const openEditor = () => {
    if (!loaded || loaded.url !== url) return;
    beginEdit(loaded.book, selected);
  };
  const saveBack = async () => {
    if (!loaded || !uploadOriginal) return;
    setSaving(true);
    try {
      const sheet = loaded.book.Sheets[selected];
      const decoded = utils.decode_range(sheet['!ref'] || 'A1');
      for (let r = 0; r < draft.length; r++) {
        for (let c = 0; c < draft[r].length; c++) {
          const text = draft[r][c];
          const address = utils.encode_cell({ r: decoded.s.r + r, c: decoded.s.c + c });
          const existing = sheet[address];
          if (text === '') {
            if (existing) delete sheet[address];
            continue;
          }
          if (existing?.f) delete existing.f;
          const numeric = text.trim() !== '' && !Number.isNaN(Number(text));
          if (numeric || existing?.t === 'n') {
            sheet[address] = { t: 'n', v: Number(text) };
          } else {
            sheet[address] = { t: 's', v: text };
          }
          decoded.e.r = Math.max(decoded.e.r, decoded.s.r + r);
          decoded.e.c = Math.max(decoded.e.c, decoded.s.c + c);
        }
      }
      sheet['!ref'] = utils.encode_range(decoded);
      const output = write(loaded.book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      const file = new File([output], title, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      await uploadOriginal(file);
      await onSaved?.();
      setDirty(false);
      setEditing(false);
      pendingSaved.current = true;
      setReload((value) => value + 1);
    } catch (reason) {
      console.error('[sheets-online]', reason);
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  if (error) return <Alert type='error' content={t('common.knowledgeLibrary.originalLoadFailed')} />;
  if (!loaded || loaded.url !== url) return <Spin tip={t('common.loading')} />;
  const columnLabel = (index: number) => {
    let label = '';
    let value = index;
    do {
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return label;
  };
  return (
    <>
      <div role='tablist' style={{ display: 'flex', gap: 8, maxWidth: '100%', overflowX: 'auto', padding: 8 }}>
        {loaded.book.SheetNames.map((name) => (
          <Button
            key={name}
            role='tab'
            aria-selected={name === selected}
            type={name === selected ? 'secondary' : 'text'}
            onClick={() => {
              setSelected(name);
              if (editing) {
                setEditing(false);
                setDirty(false);
              }
            }}
          >
            {name}
          </Button>
        ))}
        <span style={{ flex: 1 }} />
        {editing ? (
          <Button
            size='small'
            onClick={() => {
              setEditing(false);
              setDirty(false);
            }}
          >
            {t('common.knowledgeLibrary.read')}
          </Button>
        ) : (
          <Button size='small' type='primary' onClick={openEditor}>
            {t('common.knowledgeLibrary.onlineEdit')}
          </Button>
        )}
        {editing && dirty && uploadOriginal && (
          <Button size='small' type='primary' loading={saving} onClick={() => void saveBack()}>
            {t('common.knowledgeLibrary.onlineSave')}
          </Button>
        )}
      </div>
      {saved && <Alert type='success' content={t('common.knowledgeLibrary.onlineSaved')} />}
      {editing ? (
        <>
          <Alert type='info' content={t('common.knowledgeLibrary.onlineEditNote')} />
          <div style={{ overflow: 'auto', maxHeight: 'calc(100% - 120px)', padding: 8 }}>
            <table style={{ borderCollapse: 'collapse' }}>
              <tbody>
                {draft.map((row, r) => (
                  <tr key={r}>
                    <th
                      style={{
                        position: 'sticky',
                        left: 0,
                        background: '#f3f5fa',
                        border: '1px solid #dce1e9',
                        padding: '4px 8px',
                        fontWeight: 600,
                      }}
                    >
                      {r + 1}
                    </th>
                    {row.map((value, c) => (
                      <td
                        key={c}
                        style={{
                          border: '1px solid #dce1e9',
                          padding: 0,
                          minWidth: c === 0 ? 180 : 110,
                          background: r === 0 ? '#f8f9fc' : '#fff',
                        }}
                      >
                        <input
                          aria-label={`${columnLabel(c)}${r + 1}`}
                          defaultValue={value}
                          onChange={(event) => {
                            draft[r][c] = event.target.value;
                            setDirty(true);
                            setSaved(false);
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            font: '13px system-ui',
                            padding: '6px 8px',
                            width: c === 0 ? '100%' : '96px',
                            outline: 'none',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <Alert type='info' content={t('common.knowledgeLibrary.sheetPreviewNote')} />
          <iframe title={title} sandbox='' srcDoc={preview ?? ''} className={styles.originalFrame} />
        </>
      )}
    </>
  );
}
