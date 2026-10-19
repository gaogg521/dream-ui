/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import type { RagDocumentEntry, RagLibraryEntry } from '@/common/types/devops/devopsTypes';
import { Checkbox, Empty, Input, Message, Modal, Spin } from '@arco-design/web-react';
import { Search } from '@icon-park/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LibraryFileIcon from '../shared/LibraryFileIcon';
import { MAX_LIBRARY_ATTACHMENTS } from './libraryAttachments';

type KnowledgeAttachPickerProps = {
  visible: boolean;
  onCancel: () => void;
  /** Resolves when the chosen documents have been handed over; the dialog closes after. */
  onConfirm: (documents: RagDocumentEntry[]) => Promise<void>;
};

/**
 * Lets the user pick library documents from inside a conversation, the same way
 * the "add files" menu picks a local file.
 */
const KnowledgeAttachPicker: React.FC<KnowledgeAttachPickerProps> = ({ visible, onCancel, onConfirm }) => {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<RagDocumentEntry[]>([]);
  const [libraries, setLibraries] = useState<RagLibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setSelected([]);
    setQuery('');
    setLoading(true);
    Promise.all([
      ipcBridge.oneDevops.listRagDocuments.invoke(),
      ipcBridge.oneDevops.listRagLibraries?.invoke().catch((): RagLibraryEntry[] => []) ?? Promise.resolve([]),
    ])
      .then(([docs, libs]) => {
        if (cancelled) return;
        setDocuments(docs ?? []);
        setLibraries(libs ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) Message.error(String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const folderName = (doc: RagDocumentEntry): string | undefined =>
    libraries.find(
      (library) => library.id === doc.libraryId && (library.scope === 'personal') === (doc.scope === 'personal')
    )?.name;

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return documents
      .filter((doc) => !term || doc.title.toLowerCase().includes(term))
      .toSorted((a, b) => b.createdAt - a.createdAt);
  }, [documents, query]);

  const toggle = (id: string, checked: boolean) =>
    setSelected((previous) => {
      if (!checked) return previous.filter((item) => item !== id);
      if (previous.length >= MAX_LIBRARY_ATTACHMENTS) {
        Message.warning(t('common.knowledgeLibrary.attachLimit', { count: MAX_LIBRARY_ATTACHMENTS }));
        return previous;
      }
      return [...previous, id];
    });

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm(documents.filter((doc) => selected.includes(doc.id)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('common.knowledgeLibrary.attachPickerTitle')}
      visible={visible}
      onCancel={onCancel}
      onOk={() => void confirm()}
      confirmLoading={submitting}
      okText={t('common.knowledgeLibrary.attachConfirm', { count: selected.length })}
      okButtonProps={{ disabled: selected.length === 0 }}
      cancelText={t('common.cancel')}
      unmountOnExit
      style={{ width: 520, maxWidth: 'calc(100vw - 32px)' }}
    >
      <Input
        allowClear
        prefix={<Search />}
        value={query}
        onChange={setQuery}
        placeholder={t('common.knowledgeLibrary.attachPickerSearch')}
      />
      <Spin loading={loading} className='block'>
        <div className='mt-12px max-h-360px min-h-120px overflow-y-auto'>
          {shown.length === 0 && !loading ? (
            <Empty description={t('common.knowledgeLibrary.attachPickerEmpty')} />
          ) : (
            shown.map((doc) => {
              const folder = folderName(doc);
              return (
                <Checkbox
                  key={doc.id}
                  className='flex! w-full! items-center rounded-8px px-8px py-7px hover:bg-fill-2'
                  checked={selected.includes(doc.id)}
                  onChange={(checked) => toggle(doc.id, checked)}
                >
                  <span className='flex min-w-0 items-center gap-10px'>
                    <LibraryFileIcon title={doc.title} mimeType={doc.mimeType} filePath={doc.filePath} />
                    <span className='min-w-0 flex-1 truncate text-14px text-t-primary' title={doc.title}>
                      {doc.title}
                    </span>
                    {folder && <span className='max-w-140px truncate text-12px text-t-tertiary'>{folder}</span>}
                  </span>
                </Checkbox>
              );
            })
          )}
        </div>
      </Spin>
    </Modal>
  );
};

export default KnowledgeAttachPicker;
