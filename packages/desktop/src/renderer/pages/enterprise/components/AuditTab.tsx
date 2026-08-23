/**
 * Enterprise audit log tab — read-only listing of one_audit_logs.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Select, Table } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { AuditLogEntry } from '@/common/types/org/orgTypes';

const LIMIT_OPTIONS = [50, 100, 200, 500];

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const AuditTab: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.oneAdmin.listAudit.invoke({ limit });
      setRows(data ?? []);
    } catch (e) {
      Message.error(
        t('common.enterprise.loadAuditFailed', { defaultValue: '加载审计日志失败' }) +
          ': ' +
          friendlyEnterpriseError(e, t)
      );
    } finally {
      setLoading(false);
    }
  }, [limit, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = () => {
    const header = ['time', 'user', 'action', 'resource', 'ip'];
    const lines = rows.map((r) =>
      [new Date(r.createdAt).toISOString(), r.username ?? r.userId ?? '', r.action, r.resource ?? '', r.ipAddress ?? '']
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      title: t('common.enterprise.auditColTime', { defaultValue: '时间' }),
      render: (_: unknown, record: AuditLogEntry) => new Date(record.createdAt).toLocaleString(),
    },
    {
      title: t('common.enterprise.auditColUser', { defaultValue: '用户' }),
      render: (_: unknown, record: AuditLogEntry) => record.username ?? record.userId ?? '-',
    },
    {
      title: t('common.enterprise.auditColAction', { defaultValue: '动作' }),
      dataIndex: 'action',
    },
    {
      title: t('common.enterprise.auditColResource', { defaultValue: '资源' }),
      render: (_: unknown, record: AuditLogEntry) => record.resource ?? '-',
    },
    {
      title: t('common.enterprise.auditColIp', { defaultValue: 'IP' }),
      render: (_: unknown, record: AuditLogEntry) => record.ipAddress ?? '-',
    },
  ];

  return (
    <div>
      <div className='mb-12px flex justify-end gap-8px'>
        <Select
          style={{ width: 120 }}
          value={limit}
          onChange={(v) => setLimit(Number(v))}
          options={LIMIT_OPTIONS.map((n) => ({ label: `${n}`, value: n }))}
        />
        <Button icon={<Refresh />} onClick={() => void load()}>
          {t('common.enterprise.refresh', { defaultValue: '刷新' })}
        </Button>
        <Button onClick={handleExport} disabled={rows.length === 0}>
          {t('common.enterprise.auditExport', { defaultValue: '导出 CSV' })}
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

export default AuditTab;
