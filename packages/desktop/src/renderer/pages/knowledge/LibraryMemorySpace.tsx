/**
 * Copyright 2026 One Work
 */

/**
 * "记忆空间": the assistant's own memory, shown where documents are looked for.
 *
 * The memory itself stays in the assistant's memory folder — that is what the assistant reads and
 * writes — so this is a live view of it, not a second copy that could drift. From here a memory can
 * be searched together with what is being browsed, read and edited, and copied into the library as
 * a document, where it joins everything else the library can do (search, add to a conversation).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Message, Modal, Spin, Table, Tag } from '@arco-design/web-react';
import { Edit, FileText, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { memory as memoryIpc, type EngineMemoryFile, type EngineMemoryGroup } from '@/common/adapter/ipcBridge';
import styles from './LibraryMemorySpace.module.css';

type Row = { group: EngineMemoryGroup; file: EngineMemoryFile };

type Props = {
  /** Whether the library is the company's server: a copy made from here is then stored there, privately. */
  enterprise: boolean;
  /** Reload the library after a document was added. */
  onLibraryChanged?: () => void;
};

const TYPE_COLOR: Record<string, string> = {
  user: 'arcoblue',
  feedback: 'orange',
  project: 'green',
  reference: 'purple',
};
const typeOf = (content: string): string => content.match(/^type:\s*(\w+)/m)?.[1] ?? 'reference';
const descOf = (content: string): string => content.match(/^description:\s*(.+?)$/m)?.[1]?.trim() ?? '';
const bodyOf = (content: string): string => content.replace(/^---[\s\S]*?---\n?/, '').trim();

const LibraryMemorySpace: React.FC<Props> = ({ enterprise, onLibraryChanged }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<EngineMemoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const typeLabel = (key: string): string =>
    (
      ({
        user: t('memory.typeUser'),
        feedback: t('memory.typeFeedback'),
        project: t('memory.typeProject'),
        reference: t('memory.typeReference'),
      }) as Record<string, string>
    )[key] ?? key;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGroups((await memoryIpc.engineList.invoke()).groups);
    } catch {
      Message.error(t('memory.engine.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<Row[]>(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return groups
      .filter((group) => group.kind !== 'conversation')
      .flatMap((group) => group.files.filter((file) => file.filename !== 'MEMORY.md').map((file) => ({ group, file })))
      .filter(({ file }) => {
        if (words.length === 0) return true;
        const haystack = `${file.name} ${file.content}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      })
      .toSorted((a, b) => b.file.updatedAt - a.file.updatedAt);
  }, [groups, query]);

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await memoryIpc.engineWrite.invoke({
        groupId: editing.group.id,
        filename: editing.file.filename,
        content: editContent,
      });
      setEditing(null);
      await load();
    } catch {
      Message.error(t('memory.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const copyToLibrary = (row: Row) => {
    Modal.confirm({
      title: t('memory.space.toLibraryTitle'),
      content: enterprise ? t('memory.space.toLibraryEnterprise') : t('memory.space.toLibraryBody'),
      okText: t('memory.space.toLibrary'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          const doc = await ipcBridge.oneDevops.registerRagDocument.invoke({
            title: `${row.file.name}.md`,
            mimeType: 'text/markdown',
            scope: 'personal',
          });
          const { revision } = await ipcBridge.oneDevops.getRagContentState.invoke({ id: doc.id });
          await ipcBridge.oneDevops.setRagContent.invoke({
            id: doc.id,
            content: bodyOf(row.file.content),
            expectedRevision: revision,
          });
          Message.success(t('memory.space.toLibraryDone'));
          onLibraryChanged?.();
        } catch {
          Message.error(t('memory.space.toLibraryFailed'));
        }
      },
    });
  };

  const columns = [
    {
      title: t('memory.colName'),
      dataIndex: 'file.name',
      render: (_: unknown, row: Row) => (
        <div className={styles.name}>
          <FileText theme='outline' size={14} />
          <span>{row.file.name}</span>
          {row.file.filename.startsWith('merged_') && <Tag size='small'>{t('memory.space.merged')}</Tag>}
        </div>
      ),
    },
    {
      title: t('memory.colType'),
      width: 96,
      render: (_: unknown, row: Row) => (
        <Tag size='small' color={TYPE_COLOR[typeOf(row.file.content)] ?? 'gray'}>
          {typeLabel(typeOf(row.file.content))}
        </Tag>
      ),
    },
    {
      title: t('memory.colDesc'),
      render: (_: unknown, row: Row) => <span className={styles.desc}>{descOf(row.file.content)}</span>,
    },
    {
      title: t('memory.colUpdated'),
      width: 112,
      render: (_: unknown, row: Row) => (
        <span className={styles.desc}>{new Date(row.file.updatedAt).toLocaleDateString()}</span>
      ),
    },
    {
      title: t('memory.colActions'),
      width: 190,
      render: (_: unknown, row: Row) => (
        <div className={styles.actions}>
          <Button
            type='text'
            size='mini'
            icon={<Edit theme='outline' size={13} />}
            onClick={() => {
              setEditing(row);
              setEditContent(row.file.content);
            }}
          >
            {t('memory.space.view')}
          </Button>
          <Button type='text' size='mini' onClick={() => copyToLibrary(row)}>
            {t('memory.space.toLibrary')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.root} data-testid='library-memory-space'>
      <div className={styles.head}>
        <h2 className={styles.title}>{t('common.knowledgeLibrary.memorySpace')}</h2>
        <div className={styles.headActions}>
          <Button size='small' icon={<Refresh theme='outline' />} loading={loading} onClick={() => void load()}>
            {t('memory.refresh')}
          </Button>
          <Button size='small' onClick={() => navigate('/settings/memory')}>
            {t('memory.space.openManager')}
          </Button>
        </div>
      </div>
      <p className={styles.hint}>{t('memory.space.hint')}</p>
      <Input.Search
        allowClear
        value={query}
        onChange={setQuery}
        placeholder={t('memory.space.searchPlaceholder')}
        className={styles.search}
      />
      {loading && groups.length === 0 ? (
        <div className={styles.empty}>
          <Spin loading />
        </div>
      ) : (
        <Table
          columns={columns}
          data={rows}
          rowKey={(row: Row) => row.file.path}
          size='small'
          pagination={rows.length > 12 ? { pageSize: 12 } : false}
          noDataElement={
            <div className={styles.empty}>
              {query.trim() ? t('memory.space.noMatch') : t('memory.engine.sharedEmpty')}
            </div>
          }
        />
      )}

      <Modal
        title={t('memory.editMemory', { name: editing?.file.name ?? '' })}
        visible={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void saveEdit()}
        okText={t('memory.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ loading: saving, status: 'success' }}
      >
        <Input.TextArea
          value={editContent}
          onChange={setEditContent}
          rows={14}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>
    </div>
  );
};

export default LibraryMemorySpace;
