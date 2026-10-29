/**
 * Copyright 2026 One Work
 */

/**
 * The built-in assistant's own memory — the files the model reads at the start of a conversation
 * and writes when asked to remember something. Distinct from the Claude Code tabs, which manage
 * `~/.claude`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Collapse, Input, Message, Modal, Spin, Table, Tag } from '@arco-design/web-react';
import { Add, Delete, Edit, FileText, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  memory as memoryIpc,
  type EngineCompactionStatus,
  type EngineMemoryFile,
  type EngineMemoryGroup,
  type EngineMemoryOverview,
} from '@/common/adapter/ipcBridge';
import styles from './EngineMemoryTab.module.css';

const TYPE_COLOR: Record<string, string> = {
  user: 'arcoblue',
  feedback: 'orange',
  project: 'green',
  reference: 'purple',
};
const NEW_NOTE = '---\nname: \ndescription: \ntype: user\n---\n\n';
const INDEX_FILE = 'MEMORY.md';

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

const EngineMemoryTab: React.FC = () => {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<EngineMemoryOverview | null>(null);
  const [tidy, setTidy] = useState<EngineCompactionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ groupId: string; file: EngineMemoryFile } | null>(null);
  const [editContent, setEditContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [newFilename, setNewFilename] = useState('');
  const [newContent, setNewContent] = useState(NEW_NOTE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await memoryIpc.engineList.invoke());
      // Not worth failing the page over: without it the tidy buttons simply stay hidden.
      setTidy(
        await memoryIpc.engineCompactionStatus
          .invoke({ groupId: '_shared' })
          .catch((): EngineCompactionStatus | null => null)
      );
    } catch {
      Message.error(t('memory.engine.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeLabel = (key: string): string =>
    (
      ({
        user: t('memory.typeUser'),
        feedback: t('memory.typeFeedback'),
        project: t('memory.typeProject'),
        reference: t('memory.typeReference'),
      }) as Record<string, string>
    )[key] ?? key;

  const groups = overview?.groups ?? [];
  const shared = groups.find((g) => g.kind === 'shared');
  const projects = useMemo(() => groups.filter((g) => g.kind === 'project'), [groups]);
  const legacy = useMemo(() => groups.filter((g) => g.kind === 'conversation'), [groups]);
  const legacyFileCount = legacy.reduce((sum, g) => sum + g.files.length, 0);

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await memoryIpc.engineWrite.invoke({
        groupId: editing.groupId,
        filename: editing.file.filename,
        content: editContent,
      });
      setEditing(null);
      await load();
    } catch {
      Message.error(t('memory.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const createNote = async () => {
    const trimmed = newFilename.trim();
    if (!trimmed) {
      Message.warning(t('memory.nameRequired'));
      return;
    }
    setBusy(true);
    try {
      await memoryIpc.engineWrite.invoke({
        groupId: shared?.id ?? '_shared',
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
      setBusy(false);
    }
  };

  const removeFile = (file: EngineMemoryFile) => {
    Modal.confirm({
      title: t('memory.deleteTitle'),
      content: t('memory.deleteConfirm', { name: file.name }),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          await memoryIpc.engineDelete.invoke({ path: file.path });
          await load();
        } catch {
          Message.error(t('memory.engine.deleteFailed'));
        }
      },
    });
  };

  const tidyShared = () => {
    Modal.confirm({
      title: t('memory.tidy.title'),
      content: t('memory.tidy.content', { total: tidy?.total ?? 0, mergeable: tidy?.mergeable ?? 0 }),
      okText: t('memory.tidy.agree'),
      cancelText: t('memory.tidy.later'),
      okButtonProps: { status: 'success' },
      onOk: async () => {
        try {
          const result = await memoryIpc.engineCompact.invoke({ groupId: '_shared' });
          Message.success(t('memory.tidy.done', result));
        } catch {
          Message.error(t('memory.tidy.failed'));
        }
        await load();
      },
    });
  };

  const undoTidy = () => {
    Modal.confirm({
      title: t('memory.tidy.undoTitle'),
      content: t('memory.tidy.undoContent'),
      okText: t('memory.tidy.undo'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await memoryIpc.engineUndoCompaction.invoke({ groupId: '_shared' });
          Message.success(t('memory.tidy.undone'));
        } catch {
          Message.error(t('memory.saveFailed'));
        }
        await load();
      },
    });
  };

  const mergeIntoShared = (groupIds: string[]) => {
    Modal.confirm({
      title: t('memory.engine.mergeOne'),
      content: t('memory.engine.mergeConfirm'),
      onOk: async () => {
        try {
          const result = await memoryIpc.engineMoveToShared.invoke({ groupIds });
          Message.success(t('memory.engine.mergeDone', result));
          await load();
        } catch {
          Message.error(t('memory.saveFailed'));
        }
      },
    });
  };

  const columns = (group: EngineMemoryGroup) => [
    {
      title: t('memory.colName'),
      dataIndex: 'name',
      render: (name: string, file: EngineMemoryFile) => (
        <div className='flex items-center gap-8px'>
          <FileText theme='outline' size={14} />
          <span style={{ fontWeight: 500 }}>{name}</span>
          {file.filename === INDEX_FILE && <Tag size='small'>{t('memory.engine.indexFile')}</Tag>}
        </div>
      ),
    },
    {
      title: t('memory.colType'),
      key: 'type',
      width: 88,
      render: (_: unknown, file: EngineMemoryFile) =>
        file.filename === INDEX_FILE ? null : (
          <Tag size='small' color={TYPE_COLOR[typeOf(file.content)] ?? 'gray'}>
            {typeLabel(typeOf(file.content))}
          </Tag>
        ),
    },
    {
      title: t('memory.colDesc'),
      key: 'desc',
      render: (_: unknown, file: EngineMemoryFile) => (
        <span style={{ fontSize: 12, color: 'var(--color-text-2)' }}>
          {file.filename === INDEX_FILE ? '' : descOf(file.content)}
        </span>
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
      render: (_: unknown, file: EngineMemoryFile) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            type='text'
            size='mini'
            icon={<Edit theme='outline' size={13} />}
            onClick={() => {
              setEditing({ groupId: group.id, file });
              setEditContent(file.content);
            }}
          />
          <Button
            type='text'
            size='mini'
            status='danger'
            icon={<Delete theme='outline' size={13} />}
            onClick={() => removeFile(file)}
          />
        </div>
      ),
    },
  ];

  const table = (group: EngineMemoryGroup, emptyText: string) => (
    <Table
      columns={columns(group)}
      data={group.files}
      rowKey='path'
      size='small'
      pagination={group.files.length > 10 ? { pageSize: 10 } : false}
      noDataElement={<div className={styles.empty}>{emptyText}</div>}
    />
  );

  if (loading && !overview) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin loading />
      </div>
    );
  }

  const groupHeader = (group: EngineMemoryGroup) => (
    <span className={styles.rowHeader}>
      {group.label}
      <Tag size='small'>{t('memory.engine.fileCount', { count: group.files.length })}</Tag>
    </span>
  );

  return (
    <div data-testid='engine-memory-tab' className={styles.root}>
      <p className={styles.lead}>{t('memory.engine.hint')}</p>

      <section className={styles.card}>
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <span className={styles.title}>{t('memory.engine.sharedTitle')}</span>
            {shared && <Tag size='small'>{t('memory.engine.fileCount', { count: shared.files.length })}</Tag>}
          </div>
          <div className={styles.actions}>
            <Button size='small' icon={<Refresh theme='outline' />} loading={loading} onClick={() => void load()}>
              {t('memory.refresh')}
            </Button>
            {tidy && tidy.mergeable > 0 && (
              <Button size='small' status={tidy.suggested ? 'success' : 'default'} onClick={tidyShared}>
                {t('memory.tidy.button')}
              </Button>
            )}
            {tidy?.backup && (
              <Button size='small' onClick={undoTidy}>
                {t('memory.tidy.undo')}
              </Button>
            )}
            <Button
              type='primary'
              status='success'
              size='small'
              icon={<Add theme='outline' />}
              onClick={() => setAdding(true)}
            >
              {t('memory.engine.addShared')}
            </Button>
          </div>
        </div>
        <p className={styles.hint}>{t('memory.engine.sharedHint')}</p>
        {shared && (
          <span className={styles.path} title={shared.dir}>
            {t('memory.engine.location')}: {shared.dir}
          </span>
        )}
        {shared && table(shared, t('memory.engine.sharedEmpty'))}
      </section>

      {projects.length > 0 && (
        <section className={styles.card}>
          <div className={styles.head}>
            <span className={styles.title}>{t('memory.engine.projectsTitle')}</span>
          </div>
          <p className={styles.hint}>{t('memory.engine.projectsHint')}</p>
          <Collapse bordered={false}>
            {projects.map((group) => (
              <Collapse.Item key={group.id} name={group.id} header={groupHeader(group)}>
                {table(group, '')}
              </Collapse.Item>
            ))}
          </Collapse>
        </section>
      )}

      {legacy.length > 0 && (
        <section className={styles.card} data-testid='engine-memory-legacy'>
          <div className={styles.head}>
            <span className={styles.title}>{t('memory.engine.legacyTitle')}</span>
            <div className={styles.actions}>
              <Button
                type='primary'
                status='success'
                size='small'
                loading={busy}
                onClick={() => mergeIntoShared(legacy.map((g) => g.id))}
              >
                {t('memory.engine.mergeAll')}
              </Button>
            </div>
          </div>
          <p className={styles.hint}>
            {t('memory.engine.legacyHint', { groups: legacy.length, files: legacyFileCount })}
          </p>
          <div className={styles.scroll}>
            <Collapse bordered={false}>
              {legacy.map((group) => (
                <Collapse.Item
                  key={group.id}
                  name={group.id}
                  header={groupHeader(group)}
                  extra={
                    <Button
                      size='mini'
                      onClick={(event) => {
                        event.stopPropagation();
                        mergeIntoShared([group.id]);
                      }}
                    >
                      {t('memory.engine.mergeOne')}
                    </Button>
                  }
                >
                  {table(group, '')}
                </Collapse.Item>
              ))}
            </Collapse>
          </div>
        </section>
      )}

      <Modal
        title={t('memory.editMemory', { name: editing?.file.name ?? '' })}
        visible={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void saveEdit()}
        okText={t('memory.save')}
        cancelText={t('common.cancel')}
        okButtonProps={{ loading: busy }}
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
        onOk={() => void createNote()}
        okText={t('memory.create')}
        cancelText={t('common.cancel')}
        okButtonProps={{ loading: busy }}
      >
        <div className='flex flex-col gap-12px'>
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

export default EngineMemoryTab;
