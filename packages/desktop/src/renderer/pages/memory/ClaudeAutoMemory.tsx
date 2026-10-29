/**
 * Copyright 2026 One Work
 */

/**
 * Claude Code's own per-project auto memory: `~/.claude/projects/{project}/memory/*.md`.
 *
 * Specific to Claude Code — other agents have no such directory — so it is one panel of the Claude
 * Code card, not a page of its own.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Message, Modal, Spin, Table, Tag } from '@arco-design/web-react';
import { Add, Delete, Edit, FileText, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { memory as memoryIpc, type MemoryFileEntry } from '@/common/adapter/ipcBridge';

const TYPE_COLOR: Record<string, string> = {
  user: 'arcoblue',
  feedback: 'orange',
  project: 'green',
  reference: 'purple',
};
const NEW_NOTE = '---\nname: \ndescription: \ntype: user\n---\n\n';

const typeOf = (content: string): string => content.match(/^type:\s*(\w+)/m)?.[1] ?? 'reference';

const descOf = (content: string): string => {
  const described = content.match(/^description:\s*(.+?)$/m);
  if (described) return described[1].trim();
  return (
    content
      .replace(/^---[\s\S]*?---\n?/m, '')
      .trim()
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 80) ?? ''
  );
};

type Props = {
  /** Changes when the project root does, so the list is read again. */
  version: number;
};

const ClaudeAutoMemory: React.FC<Props> = ({ version }) => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<MemoryFileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<MemoryFileEntry | null>(null);
  const [editContent, setEditContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [newFilename, setNewFilename] = useState('');
  const [newContent, setNewContent] = useState(NEW_NOTE);
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
      setEntries((await memoryIpc.list.invoke()) ?? []);
    } catch {
      Message.error(t('memory.readFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await memoryIpc.write.invoke({ filename: editing.filename, content: editContent, path: editing.path });
      setEditing(null);
      await load();
    } catch {
      Message.error(t('memory.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    const trimmed = newFilename.trim();
    if (!trimmed) {
      Message.warning(t('memory.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      await memoryIpc.write.invoke({
        filename: trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`,
        content: newContent,
      });
      setAdding(false);
      setNewFilename('');
      setNewContent(NEW_NOTE);
      Message.success(t('memory.createOk'));
      await load();
    } catch {
      Message.error(t('memory.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = (entry: MemoryFileEntry) => {
    Modal.confirm({
      title: t('memory.deleteTitle'),
      content: t('memory.deleteConfirm', { name: entry.name }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        await memoryIpc.delete.invoke({ filename: entry.filename, path: entry.path });
        await load();
      },
    });
  };

  const columns = [
    {
      title: t('memory.colName'),
      dataIndex: 'name',
      render: (name: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText theme='outline' size={14} />
          <span style={{ fontWeight: 500 }}>{name}</span>
        </div>
      ),
    },
    {
      title: t('memory.colType'),
      key: 'type',
      dataIndex: 'content',
      width: 88,
      render: (content: string) => (
        <Tag size='small' color={TYPE_COLOR[typeOf(content)] ?? 'gray'}>
          {typeLabel(typeOf(content))}
        </Tag>
      ),
    },
    {
      title: t('memory.colDesc'),
      key: 'desc',
      dataIndex: 'content',
      render: (content: string) => (
        <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>{descOf(content)}</span>
      ),
    },
    {
      title: t('memory.colUpdated'),
      dataIndex: 'updatedAt',
      width: 112,
      render: (value: number) => <span style={{ fontSize: 12 }}>{new Date(value).toLocaleDateString()}</span>,
    },
    {
      title: t('memory.colActions'),
      width: 90,
      render: (_: unknown, record: MemoryFileEntry) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type='text'
            size='mini'
            icon={<Edit theme='outline' size={13} />}
            onClick={() => {
              setEditing(record);
              setEditContent(record.content);
            }}
          />
          <Button
            type='text'
            size='mini'
            status='danger'
            icon={<Delete theme='outline' size={13} />}
            onClick={() => remove(record)}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-3)' }}>{t('memory.autoHint')}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size='small' icon={<Refresh theme='outline' />} loading={loading} onClick={() => void load()}>
            {t('memory.refresh')}
          </Button>
          <Button
            type='primary'
            status='success'
            size='small'
            icon={<Add theme='outline' />}
            onClick={() => setAdding(true)}
          >
            {t('memory.addMemory')}
          </Button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin loading />
        </div>
      ) : (
        <>
          {entries.length > 8 && !showAll && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <Button size='small' onClick={() => setShowAll(true)}>
                {t('memory.showMore')}
              </Button>
            </div>
          )}
          <Table
            columns={columns}
            data={showAll ? entries : entries.slice(0, 8)}
            rowKey='path'
            size='small'
            pagination={showAll && entries.length > 8 ? { pageSize: 8 } : false}
            noDataElement={
              <div style={{ textAlign: 'center', color: 'var(--color-text-3)', padding: '40px 0' }}>
                {t('memory.emptyAuto')}
              </div>
            }
          />
        </>
      )}

      <Modal
        title={t('memory.editMemory', { name: editing?.name ?? '' })}
        visible={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void saveEdit()}
        okText={t('memory.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ loading: saving }}
      >
        <Input.TextArea
          value={editContent}
          onChange={setEditContent}
          rows={14}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Modal>

      <Modal
        title={t('memory.newMemory')}
        visible={adding}
        onCancel={() => setAdding(false)}
        onOk={() => void create()}
        okText={t('memory.create')}
        cancelText={t('common.cancel')}
        okButtonProps={{ loading: saving }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginBottom: 6 }}>{t('memory.filename')}</div>
            <Input placeholder='user_role' value={newFilename} onChange={setNewFilename} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--color-text-3)', marginBottom: 6 }}>{t('memory.content')}</div>
            <Input.TextArea
              value={newContent}
              onChange={setNewContent}
              rows={10}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ClaudeAutoMemory;
