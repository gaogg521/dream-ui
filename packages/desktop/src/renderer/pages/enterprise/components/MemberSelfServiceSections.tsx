/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The three member-facing reads the client never made (C2-1).
 *
 * Each one is a self-service endpoint the server has always exposed and the
 * desktop client simply never called, so the project-group page answered
 * "who am I working with" with a number, the client heartbeated machines into
 * a roster it could not read back, and a member who shared a conversation had
 * no way to see or undo it afterwards.
 *
 * Read-only apart from revoking a share — that one is the member's own
 * decision about their own content, and having no way to take it back was the
 * part that actually mattered.
 *
 * Collapsed by default: this page is mostly identity, and three tables opened
 * on arrival would bury it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Collapse, Empty, Message, Popconfirm, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';

type Member = {
  userId: string;
  username: string;
  displayName?: string | null;
  role: string;
  orgUnitPath?: string | null;
};
type RuntimeNode = {
  id: string;
  machineId: string;
  displayName: string;
  status: string;
  lastSeenAt: number;
};
type OwnedShare = { conversationId: string; name: string; scope: string; sharedAt: number };

const NODE_STATUS_COLOR: Record<string, string> = {
  approved: 'green',
  pending: 'orange',
  blocked: 'red',
};

const MemberSelfServiceSections: React.FC = () => {
  const { t } = useTranslation();
  const [members, setMembers] = useState<Member[]>([]);
  const [nodes, setNodes] = useState<RuntimeNode[]>([]);
  const [shares, setShares] = useState<OwnedShare[]>([]);

  const load = useCallback(async () => {
    // Independent reads: one failing must not blank the other two, so they
    // settle separately rather than through a single await.
    const [m, n, s] = await Promise.allSettled([
      ipcBridge.onePlatform.orgMembers.invoke(),
      ipcBridge.onePlatform.myRuntimeNodes.invoke(),
      ipcBridge.onePlatform.myConversationShares.invoke(),
    ]);
    if (m.status === 'fulfilled') setMembers(m.value ?? []);
    if (n.status === 'fulfilled') setNodes(n.value ?? []);
    if (s.status === 'fulfilled') setShares(s.value ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unshare = useCallback(
    async (conversationId: string) => {
      try {
        await ipcBridge.onePlatform.unshareConversation.invoke({ conversationId });
        Message.success(t('common.selfService.unshared', { defaultValue: '已取消分享。' }));
        await load();
      } catch (e) {
        Message.error(friendlyEnterpriseError(e, t));
      }
    },
    [load, t]
  );

  return (
    <Collapse bordered={false} className='mt-16px'>
      <Collapse.Item
        name='members'
        header={t('common.selfService.membersTitle', { defaultValue: '项目组成员' })}
        extra={<span className='text-12px text-t-tertiary'>{members.length}</span>}
      >
        {members.length === 0 ? (
          <Empty description={t('common.selfService.membersEmpty', { defaultValue: '暂无成员信息。' })} />
        ) : (
          <Table
            size='small'
            rowKey='userId'
            pagination={false}
            data={members}
            columns={[
              {
                title: t('common.selfService.colMember', { defaultValue: '成员' }),
                render: (_: unknown, row: Member) => row.displayName || row.username,
              },
              { title: t('common.selfService.colRole', { defaultValue: '角色' }), dataIndex: 'role', width: 120 },
              {
                title: t('common.selfService.colDepartment', { defaultValue: '部门' }),
                dataIndex: 'orgUnitPath',
                render: (path: string | null) => path || '—',
              },
            ]}
          />
        )}
      </Collapse.Item>

      <Collapse.Item
        name='machines'
        header={t('common.selfService.machinesTitle', { defaultValue: '我的机器' })}
        extra={<span className='text-12px text-t-tertiary'>{nodes.length}</span>}
      >
        {nodes.length === 0 ? (
          <Empty description={t('common.selfService.machinesEmpty', { defaultValue: '还没有登记的机器。' })} />
        ) : (
          <Table
            size='small'
            rowKey='id'
            pagination={false}
            data={nodes}
            columns={[
              {
                title: t('common.selfService.colMachine', { defaultValue: '机器' }),
                dataIndex: 'displayName',
              },
              {
                title: t('common.selfService.colStatus', { defaultValue: '状态' }),
                dataIndex: 'status',
                width: 110,
                render: (status: string) => (
                  <Tag size='small' color={NODE_STATUS_COLOR[status] ?? 'gray'}>
                    {t(`common.selfService.nodeStatus.${status}` as 'common.selfService.nodeStatus.approved', {
                      defaultValue: status,
                    })}
                  </Tag>
                ),
              },
              {
                title: t('common.selfService.colLastSeen', { defaultValue: '最近在线' }),
                dataIndex: 'lastSeenAt',
                width: 180,
                render: (at: number) => (at ? new Date(at).toLocaleString() : '—'),
              },
            ]}
          />
        )}
      </Collapse.Item>

      <Collapse.Item
        name='shares'
        header={t('common.selfService.sharesTitle', { defaultValue: '我分享的会话' })}
        extra={<span className='text-12px text-t-tertiary'>{shares.length}</span>}
      >
        {shares.length === 0 ? (
          <Empty description={t('common.selfService.sharesEmpty', { defaultValue: '还没有分享过会话。' })} />
        ) : (
          <Table
            size='small'
            rowKey='conversationId'
            pagination={false}
            data={shares}
            columns={[
              { title: t('common.selfService.colConversation', { defaultValue: '会话' }), dataIndex: 'name' },
              {
                title: t('common.selfService.colScope', { defaultValue: '范围' }),
                dataIndex: 'scope',
                width: 120,
                render: (scope: string) =>
                  t(`common.selfService.scope.${scope}` as 'common.selfService.scope.tenant', {
                    defaultValue: scope,
                  }),
              },
              {
                title: t('common.selfService.colSharedAt', { defaultValue: '分享时间' }),
                dataIndex: 'sharedAt',
                width: 180,
                render: (at: number) => (at ? new Date(at).toLocaleString() : '—'),
              },
              {
                title: t('common.selfService.colAction', { defaultValue: '操作' }),
                width: 100,
                render: (_: unknown, row: OwnedShare) => (
                  <Popconfirm
                    title={t('common.selfService.unshareConfirm', {
                      defaultValue: '取消分享后，同事将无法再查看这次会话的内容。',
                    })}
                    onOk={() => void unshare(row.conversationId)}
                  >
                    <a className='text-danger-6 cursor-pointer'>
                      {t('common.selfService.unshare', { defaultValue: '取消分享' })}
                    </a>
                  </Popconfirm>
                ),
              },
            ]}
          />
        )}
      </Collapse.Item>
    </Collapse>
  );
};

export default MemberSelfServiceSections;
