/**
 * Enterprise runtime nodes tab — machines that heartbeat into
 * /api/one/admin/runtime/heartbeat, listed read-only.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Popconfirm, Table, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { RuntimeNode } from '@/common/types/org/orgTypes';

const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

const RuntimeTab: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RuntimeNode[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.oneAdmin.listRuntimeNodes.invoke();
      setRows(data ?? []);
    } catch (e) {
      Message.error(
        t('common.enterprise.loadRuntimeFailed', { defaultValue: '加载运行时节点失败' }) +
          ': ' +
          friendlyEnterpriseError(e, t)
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // A retired machine has no way to stop heartbeating itself — the process is
  // just gone — so the roster otherwise accumulates dead rows forever. If the
  // machine is actually still alive, deleting it here is harmless: its own
  // heartbeat loop (every 5 min while it stays in the enterprise) simply
  // re-adds it on the next beat.
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await ipcBridge.oneAdmin.deleteRuntimeNode.invoke({ id });
      Message.success(t('common.enterprise.runtimeDeleted', { defaultValue: '已删除' }));
      await load();
    } catch (e) {
      Message.error(
        t('common.enterprise.runtimeDeleteFailed', { defaultValue: '删除失败' }) + ': ' + friendlyEnterpriseError(e, t)
      );
    } finally {
      setDeletingId(null);
    }
  };

  const columns = [
    {
      title: t('common.enterprise.runtimeColName', { defaultValue: '节点' }),
      dataIndex: 'displayName',
    },
    {
      title: t('common.enterprise.runtimeColMachine', { defaultValue: '机器 ID' }),
      dataIndex: 'machineId',
    },
    {
      title: t('common.enterprise.runtimeColHostnames', { defaultValue: '主机名' }),
      render: (_: unknown, record: RuntimeNode) => asStringArray(record.hostnames).join(', ') || '-',
    },
    {
      title: t('common.enterprise.runtimeColIps', { defaultValue: 'IP 地址' }),
      render: (_: unknown, record: RuntimeNode) => asStringArray(record.ipAddresses).join(', ') || '-',
    },
    {
      title: t('common.enterprise.runtimeColAgents', { defaultValue: '已装 Agent' }),
      render: (_: unknown, record: RuntimeNode) => {
        const agents = asStringArray(record.installedAgents);
        return agents.length ? (
          <span className='flex gap-4px flex-wrap'>
            {agents.map((agent) => (
              <Tag key={agent}>{agent}</Tag>
            ))}
          </span>
        ) : (
          '-'
        );
      },
    },
    {
      title: t('common.enterprise.runtimeColLastSeen', { defaultValue: '最近心跳' }),
      render: (_: unknown, record: RuntimeNode) => new Date(record.lastSeenAt).toLocaleString(),
    },
    {
      title: t('common.enterprise.runtimeColActions', { defaultValue: '操作' }),
      render: (_: unknown, record: RuntimeNode) => (
        <Popconfirm
          title={t('common.enterprise.runtimeDeleteConfirm', {
            defaultValue: '删除此运行时节点？若机器仍在线，下次心跳会重新出现。',
          })}
          onOk={() => void handleDelete(record.id)}
        >
          <Button size='small' status='danger' loading={deletingId === record.id}>
            {t('common.delete', { defaultValue: '删除' })}
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div className='mb-12px flex justify-end'>
        <Button icon={<Refresh />} onClick={() => void load()}>
          {t('common.enterprise.refresh', { defaultValue: '刷新' })}
        </Button>
      </div>
      <Table
        rowKey='id'
        loading={loading}
        columns={columns}
        data={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </div>
  );
};

export default RuntimeTab;
