/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Company directory sync (T6) — the org chart pulled from the IdP, and who it
 * says has left.
 *
 * ⚠️ What this screen has to make true, and why the copy is worded as it is:
 *
 * - **A partial sync is not an empty company.** When the last pull did not
 *   finish, the mirror is stale *and* no departures were derived from it. A
 *   reassuring "nobody has left" would be a lie, so a partial run gets a
 *   warning banner instead of a quiet empty table.
 * - **The departed list is a suggestion, never an action.** Offboarding
 *   removes access, rotates tokens and reassigns work. Each row opens the same
 *   confirm-and-hand-over dialog the member page uses — which already does
 *   transfer → remove → release seat in the right order — rather than becoming
 *   a button that fires because an API said somebody was missing. There is
 *   deliberately no "process all" action: one bad pull would then offboard the
 *   whole company in a click.
 * - **Removal is project-group scoped; this list is not.** The backend removes
 *   from the caller's *active* project group, and a hand-over needs the
 *   recipient inside that same group. So each row is matched against the
 *   admin's current group first: inside it, the full flow; otherwise the dialog
 *   drops to releasing the seat and cutting credentials, and names the groups
 *   that still need attention instead of firing a call that would fail.
 * - **Directory people are not seats.** The mirror holds everyone the IdP
 *   lists; licensed seats are only the people who actually signed in. The copy
 *   says so, because "1000 people synced" would otherwise read as a bill.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Input, Message, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { AdminUser, DepartedMember, DirectoryPerson, DirectorySyncState } from '@/common/types/org/orgTypes';
import OffboardMemberModal, { type OffboardMode } from './OffboardMemberModal';
import { useOrgContext } from '../hooks/useOrgContext';

const formatTime = (ms?: number | null): string => (ms ? new Date(ms).toLocaleString() : '—');

const DirectoryTab: React.FC = () => {
  const { t } = useTranslation();
  const { context } = useOrgContext();
  const [status, setStatus] = useState<DirectorySyncState | null>(null);
  const [departed, setDeparted] = useState<DepartedMember[]>([]);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [peopleFilter, setPeopleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  /** Roster of the admin's active project group — the hand-over candidates. */
  const [groupMembers, setGroupMembers] = useState<AdminUser[]>([]);
  const [offboardTarget, setOffboardTarget] = useState<DepartedMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [state, gone, roster] = await Promise.all([
        ipcBridge.oneEnterprise.directoryStatus.invoke(),
        ipcBridge.oneEnterprise.directoryDeparted.invoke(),
        ipcBridge.oneEnterprise.directoryPeople.invoke(),
      ]);
      setStatus(state ?? null);
      setDeparted(gone ?? []);
      setPeople(roster ?? []);
    } catch {
      // Leave whatever was already on screen rather than blanking it: a failed
      // refresh is not evidence that the directory is empty.
    } finally {
      setLoading(false);
    }
    // Separately, and tolerant of failure: a company admin who is not an admin
    // of any project group cannot read this roster, and that is fine — it only
    // costs them the hand-over dropdown, not the page.
    try {
      setGroupMembers((await ipcBridge.oneAdmin.listUsers.invoke()) ?? []);
    } catch {
      setGroupMembers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await ipcBridge.oneAdmin.runDirectorySync.invoke();
      if (!result.ran) {
        // Not an error — this deployment simply has no directory to sync.
        Message.info(result.skipped || t('common.enterprise.directorySkipped'));
      } else if (!result.complete) {
        Message.warning(t('common.enterprise.directoryPartial', { error: result.error || '' }));
      } else {
        Message.success(
          t('common.enterprise.directorySynced', {
            departments: result.departments,
            people: result.people,
          })
        );
      }
      await load();
    } catch (e) {
      Message.error(t('common.enterprise.directorySyncFailed') + ': ' + String(e));
    } finally {
      setSyncing(false);
    }
  }, [load, t]);

  const partial = status?.lastStatus === 'partial';

  /**
   * Which flow a row can actually complete. The full one needs the person to be
   * in the group the backend will act on — the admin's active project group.
   */
  const modeFor = useCallback(
    (member: DepartedMember): OffboardMode =>
      context?.tenantId && (member.tenants ?? []).some((tenant) => tenant.tenantId === context.tenantId)
        ? 'project-group'
        : 'company-only',
    [context?.tenantId]
  );

  const handleOffboarded = useCallback((userId: string) => {
    setDeparted((prev) => prev.filter((m) => m.userId !== userId));
    setOffboardTarget(null);
  }, []);

  const filteredPeople = useMemo(() => {
    const q = peopleFilter.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) => (p.name ?? '').toLowerCase().includes(q) || (p.department ?? '').toLowerCase().includes(q)
    );
  }, [people, peopleFilter]);

  return (
    <div className='flex flex-col gap-16px'>
      <Alert type='info' content={t('common.enterprise.directoryIntro')} />

      {partial && (
        <Alert
          type='warning'
          content={t('common.enterprise.directoryPartialBanner', { error: status?.lastError || '' })}
        />
      )}

      <div className='flex justify-between items-center'>
        <span className='font-medium'>{t('common.enterprise.directoryStatusTitle')}</span>
        <Button type='primary' loading={syncing} onClick={handleSync}>
          {t('common.enterprise.directorySyncNow')}
        </Button>
      </div>

      <Descriptions
        column={2}
        data={[
          { label: t('common.enterprise.directoryProvider'), value: status?.provider || '—' },
          { label: t('common.enterprise.directoryLastRun'), value: formatTime(status?.lastRunAt) },
          {
            label: t('common.enterprise.directoryDepartments'),
            value: String(status?.departmentCount ?? 0),
          },
          {
            label: t('common.enterprise.directoryPeople'),
            value: String(status?.peopleCount ?? 0),
          },
        ]}
      />

      <div className='flex items-center justify-between'>
        <span className='font-medium'>{t('common.enterprise.directoryPeopleTitle', { count: people.length })}</span>
        <Input.Search
          allowClear
          style={{ width: 240 }}
          placeholder={t('common.enterprise.directoryPeopleSearchPlaceholder', { defaultValue: '搜索姓名或部门' })}
          value={peopleFilter}
          onChange={setPeopleFilter}
        />
      </div>
      <Table
        loading={loading}
        rowKey='externalId'
        data={filteredPeople}
        pagination={{ pageSize: 10, showTotal: true }}
        noDataElement={
          <Empty description={t('common.enterprise.directoryPeopleEmpty', { defaultValue: '暂无通讯录成员' })} />
        }
        columns={[
          {
            title: t('common.enterprise.directoryMember'),
            dataIndex: 'name',
            render: (_: unknown, row: DirectoryPerson) => row.name || row.externalId,
          },
          {
            title: t('common.enterprise.directoryDepartment'),
            dataIndex: 'department',
            render: (v: string) => v || '—',
          },
          {
            title: t('common.enterprise.directoryJobTitle', { defaultValue: '职位' }),
            dataIndex: 'jobTitle',
            render: (v: string) => v || '—',
          },
        ]}
      />

      <div className='font-medium'>{t('common.enterprise.directoryDepartedTitle', { count: departed.length })}</div>
      <Alert type='info' content={t('common.enterprise.directoryDepartedHint')} />

      <Table
        loading={loading}
        rowKey='userId'
        data={departed}
        pagination={false}
        noDataElement={<Empty description={t('common.enterprise.directoryDepartedEmpty')} />}
        columns={[
          {
            title: t('common.enterprise.directoryMember'),
            dataIndex: 'displayName',
            render: (_: unknown, row: DepartedMember) => row.displayName || row.userId,
          },
          { title: t('common.enterprise.directoryDepartment'), dataIndex: 'department' },
          {
            title: t('common.enterprise.directoryMissingSince'),
            dataIndex: 'missingSince',
            render: (v: number) => formatTime(v),
          },
          {
            title: t('common.enterprise.directoryState'),
            render: () => <Tag color='orange'>{t('common.enterprise.directoryGone')}</Tag>,
          },
          {
            title: t('common.enterprise.directoryGroups'),
            render: (_: unknown, row: DepartedMember) =>
              (row.tenants ?? []).length === 0
                ? t('common.enterprise.directoryNoGroup')
                : (row.tenants ?? []).map((tenant) => tenant.name || tenant.tenantId).join('、'),
          },
          {
            title: t('common.enterprise.directoryActions'),
            render: (_: unknown, row: DepartedMember) => (
              <Button size='mini' status='danger' onClick={() => setOffboardTarget(row)}>
                {t('common.enterprise.directoryOffboard')}
              </Button>
            ),
          },
        ]}
      />

      <OffboardMemberModal
        target={
          offboardTarget
            ? {
                userId: offboardTarget.userId,
                displayName: offboardTarget.displayName || offboardTarget.userId,
                tenants: offboardTarget.tenants,
              }
            : null
        }
        mode={offboardTarget ? modeFor(offboardTarget) : 'company-only'}
        candidates={groupMembers
          .filter((u) => u.userId !== offboardTarget?.userId)
          .map((u) => ({ userId: u.userId, label: u.displayName ?? u.username }))}
        onCancel={() => setOffboardTarget(null)}
        onDone={handleOffboarded}
      />
    </div>
  );
};

export default DirectoryTab;
