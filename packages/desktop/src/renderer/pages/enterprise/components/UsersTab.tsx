/**
 * Enterprise members tab — list users, change roles, and offboard (P0-2).
 *
 * system_admin can only be granted by an existing system_admin (backend
 * enforces this too; the Select just hides the option for org_admin).
 *
 * Offboarding is a two-step flow on purpose: a departing member's team
 * resources (P1-2) would be left with no one able to administer them, so the
 * dialog surfaces how many they own and offers a hand-over before the removal
 * goes through.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Select, Table, Tag } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { AdminUser, Department } from '@/common/types/org/orgTypes';
import OffboardMemberModal from './OffboardMemberModal';
import { isSystemAdminRole } from '../hooks/useOrgContext';

type UsersTabProps = {
  currentRole: string;
  /** Read-only member view (client-mode terminal): roster only, no role edits. */
  readOnly?: boolean;
};

const formatMs = (ms?: number | null): string => (ms ? new Date(ms).toLocaleString() : '-');

const UsersTab: React.FC<UsersTabProps> = ({ currentRole, readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  // P2-3 organizational hierarchy — the structured (admin-managed) department
  // tree, for the assignment dropdown below.
  const [departments, setDepartments] = useState<Department[]>([]);
  const canGrantSystemAdmin = isSystemAdminRole(currentRole);

  // P0-2 / P1-2 offboarding dialog state. The dialog itself is shared with the
  // company console's departed list (T6) — see OffboardMemberModal.
  const [removeTarget, setRemoveTarget] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Members read via the member-facing endpoint (no admin rights);
      // admins read the same roster via the admin endpoint.
      const [list, depts] = await Promise.all([
        readOnly ? ipcBridge.oneOrg.members.invoke() : ipcBridge.oneAdmin.listUsers.invoke(),
        readOnly ? Promise.resolve([]) : ipcBridge.oneAdmin.listDepartments.invoke().catch((): Department[] => []),
      ]);
      setUsers(list ?? []);
      setDepartments(depts ?? []);
    } catch (e) {
      Message.error(t('common.enterprise.loadUsersFailed', { defaultValue: '加载成员失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t, readOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSetRole = async (userId: string, role: string) => {
    try {
      await ipcBridge.oneAdmin.setUserRole.invoke({ userId, role });
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, role } : u)));
      Message.success(t('common.enterprise.roleUpdated', { defaultValue: '角色已更新' }));
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'LAST_ADMIN_CANNOT_LEAVE') {
        Message.error(
          t('common.enterprise.roleUpdateLastAdmin', {
            defaultValue: '此人是当前唯一的管理员，请先提升另一名成员为管理员，再降级此人。',
          })
        );
        return;
      }
      Message.error(t('common.enterprise.roleUpdateFailed', { defaultValue: '角色更新失败' }) + ': ' + String(e));
    }
  };

  // P2-3: assign (or clear, value === '') a member's structured department.
  const handleSetDepartment = async (userId: string, departmentId: string) => {
    try {
      await ipcBridge.oneAdmin.assignMemberDepartment.invoke({ userId, departmentId: departmentId || null });
      setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, departmentId: departmentId || null } : u)));
    } catch (e) {
      Message.error(t('common.enterprise.departmentAssignFailed', { defaultValue: '分配部门失败' }) + ': ' + String(e));
    }
  };

  const handleRemoved = useCallback((userId: string) => {
    setUsers((prev) => prev.filter((u) => u.userId !== userId));
    setRemoveTarget(null);
  }, []);

  const roleOptions = [
    { label: t('common.enterprise.roleMember', { defaultValue: '成员' }), value: 'member' },
    { label: t('common.enterprise.roleOrgAdmin', { defaultValue: '组织管理员' }), value: 'org_admin' },
    ...(canGrantSystemAdmin
      ? [{ label: t('common.enterprise.roleSystemAdmin', { defaultValue: '系统管理员' }), value: 'system_admin' }]
      : []),
  ];

  const columns = [
    {
      title: t('common.enterprise.usersColDisplayName', { defaultValue: '姓名' }),
      render: (_: unknown, record: AdminUser) => record.displayName ?? record.username,
    },
    {
      title: t('common.enterprise.usersColUsername', { defaultValue: '用户名' }),
      dataIndex: 'username',
    },
    {
      title: t('common.enterprise.usersColRole', { defaultValue: '角色' }),
      render: (_: unknown, record: AdminUser) => {
        const color = record.role === 'system_admin' ? 'purple' : record.role === 'org_admin' ? 'arcoblue' : 'gray';
        const label =
          record.role === 'system_admin'
            ? t('common.enterprise.roleSystemAdmin', { defaultValue: '系统管理员' })
            : record.role === 'org_admin'
              ? t('common.enterprise.roleOrgAdmin', { defaultValue: '组织管理员' })
              : t('common.enterprise.roleMember', { defaultValue: '成员' });
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: t('common.enterprise.usersColOrgUnit', { defaultValue: 'SSO 部门（同步）' }),
      render: (_: unknown, record: AdminUser) => record.orgUnitPath ?? '-',
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.enterprise.usersColDepartment', { defaultValue: '内部部门' }),
            render: (_: unknown, record: AdminUser) => (
              <Select
                size='small'
                allowClear
                style={{ width: 160 }}
                value={record.departmentId ?? ''}
                placeholder={t('common.enterprise.departmentUnassigned', { defaultValue: '未分配' })}
                onChange={(value) => void handleSetDepartment(record.userId, String(value ?? ''))}
                options={departments.map((d) => ({ label: d.name, value: d.id }))}
              />
            ),
          },
        ]),
    {
      title: t('common.enterprise.usersColJobTitle', { defaultValue: '岗位' }),
      render: (_: unknown, record: AdminUser) => record.jobTitle ?? '-',
    },
    {
      title: t('common.enterprise.usersColLastLogin', { defaultValue: '最近登录' }),
      render: (_: unknown, record: AdminUser) => formatMs(record.lastLogin),
    },
    {
      title: t('common.enterprise.usersColJoinedAt', { defaultValue: '加入时间' }),
      render: (_: unknown, record: AdminUser) => formatMs(record.createdAt),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.enterprise.usersColActions', { defaultValue: '操作' }),
            render: (_: unknown, record: AdminUser) => {
              // A non-system_admin cannot touch a system_admin's role — nor
              // remove them. The backend enforces both.
              const locked = record.role === 'system_admin' && !canGrantSystemAdmin;
              return (
                <div className='flex items-center gap-8px'>
                  <Select
                    size='small'
                    style={{ width: 140 }}
                    value={record.role}
                    options={roleOptions}
                    disabled={locked}
                    onChange={(value) => void handleSetRole(record.userId, String(value))}
                  />
                  <Button size='mini' status='danger' disabled={locked} onClick={() => setRemoveTarget(record)}>
                    {t('common.enterprise.remove')}
                  </Button>
                </div>
              );
            },
          },
        ]),
  ];

  return (
    <div>
      <div className='mb-12px flex justify-end'>
        <Button icon={<Refresh />} onClick={() => void load()}>
          {t('common.enterprise.refresh', { defaultValue: '刷新' })}
        </Button>
      </div>
      <Table
        rowKey='userId'
        loading={loading}
        columns={columns}
        data={users}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />

      {/* Offboarding: confirm + optional resource hand-over (P0-2 / P1-2). */}
      <OffboardMemberModal
        target={
          removeTarget
            ? { userId: removeTarget.userId, displayName: removeTarget.displayName ?? removeTarget.username }
            : null
        }
        mode='project-group'
        candidates={users
          .filter((u) => u.userId !== removeTarget?.userId)
          .map((u) => ({ userId: u.userId, label: u.displayName ?? u.username }))}
        onCancel={() => setRemoveTarget(null)}
        onDone={handleRemoved}
      />
    </div>
  );
};

export default UsersTab;
