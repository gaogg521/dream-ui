import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Message, Dropdown, Menu, Upload } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkTableBreaks from './remarkTableBreaks';
import CsvDocument from './CsvDocument';
import styles from './KnowledgeLibrary.module.css';
import OriginalFileViewer from './original/OriginalFileViewer';
import { usesOriginalFile } from './original/sourceKind';
import HtmlOriginal from './original/HtmlOriginal';
import OfflineOfficeEditor from './original/OfflineOfficeEditor';
import { sourceKind } from './original/sourceKind';
import IntranetOfficeEditor from './original/intranet/OfficeEditor';
import { officeApi } from './original/intranet/officeApi';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';

export function RichDocumentEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState(false);
  const latest = useRef(onChange);
  latest.current = onChange;
  const readImage = async (file: File): Promise<string> => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024)
      throw new Error(t('common.knowledgeLibrary.imageTooLarge'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };
  const editor = useEditor({
    extensions: [StarterKit, Image.configure({ allowBase64: true }), Markdown, TableKit],
    content: value,
    contentType: 'markdown',
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': t('common.knowledgeLibrary.documentContent'),
        'aria-multiline': 'true',
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const html = event.clipboardData?.getData('text/html');
        void Promise.all(files.map(readImage))
          .then((images) => {
            if (view.isDestroyed) return;
            if (html) {
              const fragment = new DOMParser().parseFromString(html, 'text/html');
              const nodes = Array.from(fragment.querySelectorAll('img'));
              nodes.forEach((node, index) => {
                if (images[index]) node.src = images[index];
              });
              editor?.commands.insertContent(fragment.body.innerHTML);
              if (!nodes.length) images.forEach((src) => editor?.commands.setImage({ src }));
            } else images.forEach((src) => editor?.commands.setImage({ src }));
          })
          .catch((error: unknown) => Message.error(String(error)));
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (!files.length) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void Promise.all(files.map(readImage))
          .then((images) => {
            if (view.isDestroyed) return;
            if (position) editor?.commands.setTextSelection(position.pos);
            images.forEach((src) => editor?.chain().focus().setImage({ src }).run());
          })
          .catch((error: unknown) => Message.error(String(error)));
        return true;
      },
    },
    onUpdate: ({ editor: current }) => latest.current(current.getMarkdown()),
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    if (editor && editor.getMarkdown() !== value)
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);
  return (
    <div className={styles.richEditor}>
      <div className={styles.richToolbar}>
        <Button type={!source ? 'secondary' : 'text'} onClick={() => setSource(false)}>
          {t('common.knowledgeLibrary.richText')}
        </Button>
        <Button type={source ? 'secondary' : 'text'} onClick={() => setSource(true)}>
          {t('common.knowledgeLibrary.source')}
        </Button>
        {!source && (
          <>
            <Button disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}>
              {t('common.knowledgeLibrary.bold')}
            </Button>
            <Button disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}>
              {t('common.knowledgeLibrary.italic')}
            </Button>
            <Button disabled={disabled} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
              {t('common.knowledgeLibrary.heading')}
            </Button>
            <Button disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
              {t('common.knowledgeLibrary.list')}
            </Button>
            <Dropdown
              trigger='click'
              droplist={
                <Menu
                  onClickMenuItem={(key) => {
                    const chain = editor?.chain().focus();
                    if (key === 'insert') chain?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
                    if (key === 'row') chain?.addRowAfter().run();
                    if (key === 'column') chain?.addColumnAfter().run();
                    if (key === 'delete') chain?.deleteTable().run();
                  }}
                >
                  <Menu.Item key='insert'>{t('common.knowledgeLibrary.table')}</Menu.Item>
                  <Menu.Item key='row'>{t('common.knowledgeLibrary.addRow')}</Menu.Item>
                  <Menu.Item key='column'>{t('common.knowledgeLibrary.addColumn')}</Menu.Item>
                  <Menu.Item key='delete'>{t('common.delete')}</Menu.Item>
                </Menu>
              }
            >
              <Button disabled={disabled}>{t('common.knowledgeLibrary.table')}</Button>
            </Dropdown>
            <Upload
              accept='image/png,image/jpeg,image/gif,image/webp'
              multiple
              showUploadList={false}
              beforeUpload={(file) => {
                void readImage(file)
                  .then((src) => editor?.chain().focus().setImage({ src }).run())
                  .catch((error: unknown) => Message.error(String(error)));
                return false;
              }}
            >
              <Button disabled={disabled}>{t('common.knowledgeLibrary.image')}</Button>
            </Upload>
          </>
        )}
      </div>
      {source ? (
        <Input.TextArea
          aria-label={t('common.knowledgeLibrary.documentContent')}
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={styles.documentEditor}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
      <div className={styles.editorHint}>{t('common.knowledgeLibrary.pasteHint')}</div>
    </div>
  );
}

type Props = {
  onOfficeSaved?: () => Promise<void>;
  registerBeforeLeave?: (guard: (() => Promise<boolean>) | null) => void;
  documentId?: string;
  sourcePath?: string | null;
  loadOriginal?: () => Promise<Blob>;
  uploadOriginal?: (file: File) => Promise<{ filePath: string | null; mimeType: string | null }>;
  title: string;
  onTitleChange?: (value: string) => void;
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
  onSave: (automatic?: boolean) => void | Promise<void>;
};

export default function LibraryDocument(props: Props) {
  const [officeEditing, setOfficeEditing] = useState(false);
  const [officeLocked, setOfficeLocked] = useState(true);
  const officeGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerOfficeGuard = (guard: (() => Promise<boolean>) | null) => {
    officeGuard.current = guard;
    props.registerBeforeLeave?.(guard);
  };
  const [source, setSource] = useState<{ filePath: string | null; mimeType: string | null } | null>(null);
  const [uploadingSource, setUploadingSource] = useState(false);
  const sourcePath = source?.filePath ?? props.sourcePath;
  const sourceMime = source?.mimeType ?? props.mimeType ?? '';
  const original = Boolean(props.documentId && props.loadOriginal && usesOriginalFile(sourcePath, sourceMime));
  const officeKind = sourceKind(sourceMime, props.title);
  const officeExtension = ({ word: '.docx', sheets: '.xlsx', slides: '.pptx' } as Record<string, string>)[officeKind];
  const [intranetAvailable, setIntranetAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    void officeApi
      .available()
      .then((result) => {
        if (active) setIntranetAvailable(result.enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const useIntranet = intranetAvailable && (!window.__offlineOffice || isEnterpriseRemoteActive());
  const canEditOffice =
    original &&
    officeExtension &&
    props.canEdit &&
    (useIntranet || (!isEnterpriseRemoteActive() && window.__offlineOffice && props.uploadOriginal));
  // Unified open path: editable Office originals go straight into the engine
  // viewer; 编辑 merely unlocks the running session.
  const officeAutoEntered = useRef(false);
  useEffect(() => {
    if (canEditOffice && !officeAutoEntered.current) {
      officeAutoEntered.current = true;
      setOfficeEditing(true);
    }
  }, [canEditOffice]);
  const pageRef = useRef<HTMLElement>(null);
  const [autoStatus, setAutoStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const submitted = useRef(JSON.stringify([props.title, props.content]));
  const [savedSnapshot, setSavedSnapshot] = useState(submitted.current);
  const failedSnapshot = useRef('');
  const inFlight = useRef(false);
  const save = useRef(props.onSave);
  save.current = props.onSave;
  useEffect(() => {
    if (props.reading && !props.loading) {
      const snapshot = JSON.stringify([props.title, props.content]);
      submitted.current = snapshot;
      setSavedSnapshot(snapshot);
      setAutoStatus('saved');
    }
  }, [props.reading, props.loading, props.title, props.content]);
  const persist = async () => {
    if (inFlight.current) return false;
    const snapshot = JSON.stringify([props.title, props.content]);
    inFlight.current = true;
    setAutoStatus('saving');
    try {
      await save.current(true);
      submitted.current = snapshot;
      setSavedSnapshot(snapshot);
      failedSnapshot.current = '';
      setAutoStatus('saved');
      return true;
    } catch {
      failedSnapshot.current = snapshot;
      setAutoStatus('error');
      return false;
    } finally {
      inFlight.current = false;
    }
  };
  useEffect(() => {
    const snapshot = JSON.stringify([props.title, props.content]);
    if (
      props.reading ||
      original ||
      !props.canEdit ||
      props.loading ||
      props.saving ||
      inFlight.current ||
      snapshot === submitted.current ||
      failedSnapshot.current === snapshot
    )
      return;
    const timer = setTimeout(() => {
      void persist();
    }, 1200);
    return () => clearTimeout(timer);
  }, [props.title, props.content, props.reading, props.canEdit, props.loading, props.saving, autoStatus, original]);

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
        <Button
          type='text'
          onClick={() => {
            if (props.reading || JSON.stringify([props.title, props.content]) === submitted.current) props.onBack();
            else
              void persist().then((saved) => {
                if (saved) props.onBack();
              });
          }}
          disabled={props.saving || autoStatus === 'saving'}
        >
          {t('common.knowledgeLibrary.backToLibrary')}
        </Button>
        <div className={styles.documentIdentity}>
          <strong title={props.title}>{props.title || t('common.knowledgeLibrary.untitled')}</strong>
          <span title={props.location}>{props.location}</span>
        </div>
        <div className={styles.documentCommands}>
          {canEditOffice && officeEditing && officeLocked && (
            <Button onClick={() => setOfficeLocked(false)}>{t('common.edit')}</Button>
          )}
          {props.canEdit && !original && (
            <span className={styles.editorHint} role='status'>
              {t(
                `common.knowledgeLibrary.${autoStatus === 'error' ? 'saveFailed' : props.saving || autoStatus === 'saving' || JSON.stringify([props.title, props.content]) !== savedSnapshot ? 'saving' : !props.content.trim() ? 'autoSave' : 'autoSaved'}`
              )}
            </span>
          )}
          {props.documentId && props.uploadOriginal && props.canEdit && (!officeEditing || officeLocked) && (
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                if (file.size > 100 * 1024 * 1024) {
                  Message.error(t('common.knowledgeLibrary.originalTooLarge'));
                  return false;
                }
                setUploadingSource(true);
                // Replacement must not race the open engine session: flush any
                // pending bytes, drop the session, then re-enter on the new file.
                const settle =
                  officeEditing && !officeLocked
                    ? Promise.resolve(officeGuard.current?.() ?? true).catch(() => false)
                    : Promise.resolve(true);
                void settle.finally(() => {
                  setOfficeEditing(false);
                  setOfficeLocked(true);
                  officeAutoEntered.current = false;
                  void props.uploadOriginal!(file)
                    .then((metadata) => {
                      setSource(metadata);
                      props.onReading(true);
                    })
                    .catch(() => Message.error(t('common.knowledgeLibrary.originalUploadFailed')))
                    .finally(() => setUploadingSource(false));
                });
                return false;
              }}
            >
              <Button loading={uploadingSource}>
                {t(`common.knowledgeLibrary.${original ? 'replaceOriginal' : 'attachOriginal'}`)}
              </Button>
            </Upload>
          )}
          {!props.onTitleChange && !original && (
            <>
              <Button
                type={props.reading ? 'secondary' : 'text'}
                onClick={() => {
                  if (JSON.stringify([props.title, props.content]) === submitted.current) props.onReading(true);
                  else
                    void persist().then((saved) => {
                      if (saved) props.onReading(true);
                    });
                }}
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
            </>
          )}
          {!props.reading && props.canEdit && !original && (
            <Button
              type='primary'
              onClick={() => {
                void persist();
              }}
              loading={props.saving || autoStatus === 'saving'}
              disabled={props.loading}
            >
              {t('common.save')}
            </Button>
          )}
        </div>
      </header>
      <div className={original ? styles.originalCanvas : styles.documentCanvas}>
        {officeEditing && canEditOffice ? (
          useIntranet ? (
            <IntranetOfficeEditor
              documentId={props.documentId!}
              locked={officeLocked}
              registerBeforeLeave={registerOfficeGuard}
              onSaved={async (version) => {
                setSource({ filePath: `rag-source:${version}`, mimeType: sourceMime });
                await props.onOfficeSaved?.();
              }}
            />
          ) : (
            <OfflineOfficeEditor
              fileName={/\.(docx|xlsx|pptx)$/i.test(props.title) ? props.title : `${props.title}${officeExtension}`}
              mime={sourceMime}
              locked={officeLocked}
              load={props.loadOriginal!}
              save={props.uploadOriginal!}
              registerBeforeLeave={registerOfficeGuard}
            />
          )
        ) : original ? (
          <OriginalFileViewer
            id={`${props.documentId}:${sourcePath}`}
            title={props.title}
            mime={sourceMime}
            load={props.loadOriginal!}
          />
        ) : (
          <>
            {props.documentId && !props.mimeType && !/\.(md|csv|html?)$/i.test(props.title) && (
              <Alert type='info' content={t('common.knowledgeLibrary.originalNotRetained')} />
            )}
            {props.loading ? (
              <div className={styles.documentPaper}>{t('common.loading')}</div>
            ) : props.reading ? (
              html ? (
                <HtmlOriginal title={props.title} content={props.content} />
              ) : (
                <article className={styles.documentPaper}>
                  {csv ? (
                    <CsvDocument value={props.content} readOnly />
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkTableBreaks]}
                      urlTransform={(url) =>
                        /^(https?:|mailto:|#|\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(url) ? url : ''
                      }
                    >
                      {props.content}
                    </ReactMarkdown>
                  )}
                </article>
              )
            ) : (
              <div className={styles.documentPaper}>
                {props.onTitleChange && (
                  <Input
                    className={styles.documentTitle}
                    aria-label={t('common.superAssistant.registries.colTitle')}
                    value={props.title}
                    onChange={props.onTitleChange}
                    placeholder={t('common.knowledgeLibrary.untitled')}
                  />
                )}
                {csv ? (
                  <CsvDocument value={props.content} onChange={props.onChange} />
                ) : (
                  <>
                    {html ? (
                      <Input.TextArea
                        aria-label={t('common.knowledgeLibrary.documentContent')}
                        value={props.content}
                        onChange={props.onChange}
                        className={styles.documentEditor}
                      />
                    ) : (
                      <RichDocumentEditor value={props.content} onChange={props.onChange} />
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
