/**
 * Agent-run audit (P1-1): which tools the agents invoked — files touched,
 * commands run — across the org, admin-visible + exportable. Turns "local-first"
 * into "auditable local-first". Reconstructed server-side from persisted
 * tool-call messages (one-org `/admin/agent-audit`, AuditLog-tier-gated).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Message, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { AgentAuditEntry } from '@/common/types/org/orgTypes';

/** A few well-known tools get a color; everything else is neutral. */
const TOOL_COLOR: Record<string, string> = {
  Bash: 'red',
  Write: 'orange',
  Edit: 'orange',
  Read: 'arcoblue',
  Glob: 'gray',
  Grep: 'gray',
};

const csvEscape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The API call below always passes this as `limit` — matched here so the
 * UI can tell "there might be more, silently cut off" from "this really is
 * everything", which a bare row count can't distinguish on its own. */
const QUERY_LIMIT = 1000;

const AgentAuditTab: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AgentAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolFilter, setToolFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.oneOrg.agentAudit.invoke({
        tool: toolFilter.trim() || undefined,
        userId: userFilter.trim() || undefined,
        limit: QUERY_LIMIT,
      });
      setRows(data ?? []);
    } catch (error) {
      Message.error(
        t('common.agentAudit.loadFailed', { defaultValue: '加载失败' }) + ': ' + friendlyEnterpriseError(error, t)
      );
    } finally {
      setLoading(false);
    }
  }, [t, toolFilter, userFilter]);

  useEffect(() => {
    void refresh();
    // Initial load only; filters apply via the "查询" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExport = () => {
    const header = ['time', 'user', 'tool', 'detail', 'status', 'conversationId'];
    const lines = rows.map((r) =>
      [
        new Date(r.createdAt).toISOString(),
        r.userId ?? '',
        r.toolName,
        r.detail ?? '',
        r.status ?? '',
        r.conversationId,
      ]
        .map((v) => csvEscape(String(v)))
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      title: t('common.agentAudit.colTime', { defaultValue: '时间' }),
      render: (_: unknown, r: AgentAuditEntry) => new Date(r.createdAt).toLocaleString(),
    },
    {
      title: t('common.agentAudit.colUser', { defaultValue: '成员' }),
      render: (_: unknown, r: AgentAuditEntry) => r.userId ?? '—',
    },
    {
      title: t('common.agentAudit.colTool', { defaultValue: '工具' }),
      render: (_: unknown, r: AgentAuditEntry) => (
        <Tag size='small' color={TOOL_COLOR[r.toolName] ?? 'gray'}>
          {r.toolName || '—'}
        </Tag>
      ),
    },
    {
      title: t('common.agentAudit.colDetail', { defaultValue: '目标（文件/命令）' }),
      render: (_: unknown, r: AgentAuditEntry) => (
        <span className='text-12px text-t-secondary break-all'>{r.detail ?? ''}</span>
      ),
    },
    {
      title: t('common.agentAudit.colStatus', { defaultValue: '状态' }),
      render: (_: unknown, r: AgentAuditEntry) => r.status ?? '—',
    },
  ];

  return (
    <Card
      title={t('common.agentAudit.title', { defaultValue: 'Agent 运行审计' })}
      extra={
        <Button size='small' onClick={handleExport} disabled={rows.length === 0}>
          {t('common.agentAudit.export', { defaultValue: '导出 CSV' })}
        </Button>
      }
    >
      <div className='mb-12px flex flex-wrap items-center gap-8px'>
        <Input
          allowClear
          style={{ width: 180 }}
          value={toolFilter}
          onChange={setToolFilter}
          placeholder={t('common.agentAudit.filterTool', { defaultValue: '按工具（Read/Bash…）' })}
        />
        <Input
          allowClear
          style={{ width: 220 }}
          value={userFilter}
          onChange={setUserFilter}
          placeholder={t('common.agentAudit.filterUser', { defaultValue: '按成员 ID' })}
        />
        <Button type='primary' size='small' onClick={() => void refresh()}>
          {t('common.agentAudit.query', { defaultValue: '查询' })}
        </Button>
      </div>
      <div className='mb-8px text-11px text-t-tertiary'>
        {t('common.agentAudit.hint', {
          defaultValue: '记录 agent 每次调用的工具、触碰的文件与运行的命令，用于安全审计与合规。',
        })}
      </div>
      {rows.length >= QUERY_LIMIT && (
        <div className='mb-8px text-11px text-warning'>
          {t('common.agentAudit.limitHint', {
            count: QUERY_LIMIT,
            defaultValue: `仅显示最近 {{count}} 条，可能还有更多记录未显示，请使用筛选条件缩小范围。`,
          })}
        </div>
      )}
      <Table
        rowKey='id'
        loading={loading}
        columns={columns}
        data={rows}
        size='small'
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
};

export default AgentAuditTab;
