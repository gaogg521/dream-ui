/**
 * Company (真实企业) admin console — the governance tier ABOVE project groups
 * (Direction B).
 *
 * This console owns everything whose DATA is enterprise- or deployment-scoped,
 * so that the guard a surface sits behind matches the blast radius of the data
 * it edits:
 *
 * | surface        | backing data                                   | scope      |
 * |----------------|------------------------------------------------|------------|
 * | 成员 / 项目组   | one_enterprise_members / one_tenants           | enterprise |
 * | 企业认证 (SSO)  | one_sso_providers (no scope column)            | deployment |
 * | 订阅与用量      | one_enterprise_license / one_usage_events      | enterprise |
 * | 备份与恢复      | every tenant's rows + licence + SSO wiring     | deployment |
 *
 * They used to live on the PROJECT-GROUP console, which meant a group admin
 * could move the whole company's budget or walk away with another group's
 * roster. Project-group settings now keep only genuinely `tenant_id`-scoped
 * surfaces (members, invites, departments, audit, runtime, integrations).
 *
 * Hidden unless a company exists AND the viewer is a company admin (the
 * settings entry gates on the same condition); a system_admin with no company
 * yet sees an explicit "设立企业" setup card. Personal / standalone never has a
 * company, so this page is unreachable there.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Input,
  InputNumber,
  Message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { getEnterpriseSession } from '@/common/adapter/enterpriseMode';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';
import SsoSettingsTab from '@/renderer/pages/enterprise/components/SsoSettingsTab';
import BillingTab from '@/renderer/pages/enterprise/components/BillingTab';
import MediaLedgerTab from '@/renderer/pages/enterprise/components/MediaLedgerTab';
import ContentInspectionTab from '@/renderer/pages/enterprise/components/ContentInspectionTab';
import DirectoryTab from '@/renderer/pages/enterprise/components/DirectoryTab';
import ModelChannelsTab from '@/renderer/pages/enterprise/components/ModelChannelsTab';
import BackupTab from '@/renderer/pages/enterprise/BackupTab';
import { useCompanyIdentity } from '@/renderer/pages/enterprise/hooks/useCompanyIdentity';
import {
  isSystemAdminRole,
  useOrgContext,
  ORG_CONTEXT_CHANGED_EVENT,
} from '@/renderer/pages/enterprise/hooks/useOrgContext';
import type {
  CompanyInvite,
  CompanyMember,
  DirectoryPerson,
  EnterpriseTenant,
  OrgInvite,
} from '@/common/types/org/orgTypes';

const notifyOrgChanged = (): void => {
  window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
};

/** system_admin with no company yet: establish it explicitly ("显式设立"). */
const SetupCompanyCard: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await ipcBridge.oneEnterprise.setupCompany.invoke({ name: name.trim() });
      Message.success(t('common.company.setupDone', { defaultValue: '企业已设立' }));
      notifyOrgChanged();
      onDone();
    } catch (e) {
      Message.error(String(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className='border border-border-2 bg-bg-2 rd-8px p-16px max-w-560px'>
      <div className='text-15px font-600 text-t-primary mb-4px'>
        {t('common.company.setupTitle', { defaultValue: '设立企业' })}
      </div>
      <div className='text-t-secondary text-13px mb-12px'>
        {t('common.company.setupHint', {
          defaultValue: '为本服务器设立一个企业（公司）。设立后你将成为企业管理员，可创建并管理多个项目组。',
        })}
      </div>
      <div className='flex items-center gap-8px'>
        <Input
          value={name}
          onChange={setName}
          placeholder={t('common.company.namePlaceholder', { defaultValue: '公司名称' })}
          className='max-w-320px'
        />
        <Button type='primary' loading={saving} onClick={() => void submit()}>
          {t('common.company.setupButton', { defaultValue: '设立企业' })}
        </Button>
      </div>
    </div>
  );
};

const OverviewTab: React.FC<{ tenantCount: number }> = ({ tenantCount }) => {
  const { t } = useTranslation();
  const { company, isCompanyAdmin, refresh } = useCompanyIdentity();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [disbanding, setDisbanding] = useState(false);
  const [disbandConfirmText, setDisbandConfirmText] = useState('');
  const [disbandBusy, setDisbandBusy] = useState(false);

  const openRename = useCallback(() => {
    setRenameValue(company?.name ?? '');
    setRenaming(true);
  }, [company?.name]);

  const submitRename = useCallback(async () => {
    const name = renameValue.trim();
    if (!name) {
      Message.warning(t('common.company.namePlaceholder', { defaultValue: '公司名称' }));
      return;
    }
    setSaving(true);
    try {
      await ipcBridge.oneEnterprise.renameCompany.invoke({ name });
      Message.success(t('common.company.renameSuccess', { defaultValue: '已更新公司名称' }));
      setRenaming(false);
      await refresh();
      notifyOrgChanged();
    } catch (e) {
      Message.error(t('common.company.renameFailed', { defaultValue: '更新失败' }) + ': ' + String(e));
    } finally {
      setSaving(false);
    }
  }, [refresh, renameValue, t]);

  const submitDisband = useCallback(async () => {
    if (disbandConfirmText.trim() !== (company?.name ?? '')) return;
    setDisbandBusy(true);
    try {
      const result = await ipcBridge.oneEnterprise.disbandCompany.invoke();
      Message.success(
        t('common.company.disbandSuccess', {
          defaultValue: '企业已解散（{{groups}} 个项目组、{{members}} 名成员已一并删除）。',
          groups: result.deletedProjectGroupIds.length,
          members: result.removedMemberCount,
        })
      );
      setDisbanding(false);
      setDisbandConfirmText('');
      // No `refresh()` needed here — the company this OverviewTab instance
      // reads is gone, and the parent CompanyConsole's own useCompanyIdentity
      // (listening to the same event) will re-render this whole subtree away
      // in favour of SetupCompanyCard once it sees `company: null`.
      notifyOrgChanged();
    } catch (e) {
      Message.error(t('common.company.disbandFailed', { defaultValue: '解散失败' }) + ': ' + String(e));
    } finally {
      setDisbandBusy(false);
    }
  }, [company?.name, disbandConfirmText, t]);

  if (!company) return null;
  return (
    <>
      <Descriptions
        column={1}
        border
        data={[
          {
            label: t('common.company.fieldName', { defaultValue: '公司名称' }),
            value: (
              <span className='flex items-center gap-8px'>
                <span>{company.name ?? '—'}</span>
                {isCompanyAdmin ? (
                  <Button type='text' size='mini' className='!p-0' onClick={openRename}>
                    {t('common.company.renameButton', { defaultValue: '编辑' })}
                  </Button>
                ) : null}
              </span>
            ),
          },
          {
            label: t('common.company.fieldMembers', { defaultValue: '成员数' }),
            value: String(company.memberCount),
          },
          {
            label: t('common.company.fieldGroups', { defaultValue: '项目组数' }),
            value: String(tenantCount),
          },
          {
            label: t('common.company.fieldOrigin', { defaultValue: '建立方式' }),
            value:
              company.origin === 'manual'
                ? t('common.company.originManual', { defaultValue: '手动设立' })
                : t('common.company.originSso', { defaultValue: 'SSO 自动' }),
          },
        ]}
      />
      <Modal
        title={t('common.company.renameTitle', { defaultValue: '修改公司名称' })}
        visible={renaming}
        onCancel={() => setRenaming(false)}
        onOk={() => void submitRename()}
        confirmLoading={saving}
        maskClosable={false}
      >
        <Input
          value={renameValue}
          onChange={setRenameValue}
          placeholder={t('common.company.namePlaceholder', { defaultValue: '公司名称' })}
          onPressEnter={() => void submitRename()}
        />
      </Modal>
      {isCompanyAdmin ? (
        <div className='mt-24px border border-danger-2 rd-8px p-16px max-w-560px'>
          <div className='text-14px font-600 text-danger-6 mb-4px'>
            {t('common.company.dangerZoneTitle', { defaultValue: '危险区域' })}
          </div>
          <div className='text-t-secondary text-13px mb-12px'>
            {t('common.company.disbandHint', {
              defaultValue: '解散企业会删除本企业名下所有项目组、成员关系与用量记录，且不可恢复。',
            })}
          </div>
          <Button status='danger' onClick={() => setDisbanding(true)}>
            {t('common.company.disbandButton', { defaultValue: '解散企业' })}
          </Button>
        </div>
      ) : null}
      <Modal
        title={t('common.company.disbandConfirmTitle', { defaultValue: '解散企业？' })}
        visible={disbanding}
        onCancel={() => {
          setDisbanding(false);
          setDisbandConfirmText('');
        }}
        onOk={() => void submitDisband()}
        okButtonProps={{ status: 'danger', disabled: disbandConfirmText.trim() !== (company.name ?? '') }}
        confirmLoading={disbandBusy}
        maskClosable={false}
      >
        <div className='mb-12px text-t-secondary'>
          {t('common.company.disbandConfirmDesc', {
            defaultValue: '此操作不可恢复。请输入公司名称「{{name}}」以确认：',
            name: company.name ?? '',
          })}
        </div>
        <Input
          value={disbandConfirmText}
          onChange={setDisbandConfirmText}
          placeholder={company.name ?? ''}
          onPressEnter={() => void submitDisband()}
        />
      </Modal>
    </>
  );
};

/**
 * Directory-person picker for "邀请成员". A separate flow from the members
 * table below: it never touches `one_enterprise_members` directly (only a
 * real SSO login does that) — this just writes a `one_enterprise_invites`
 * row. Hardcodes `provider: 'feishu'` because directory sync only supports
 * Feishu today (see DirectoryTab's own "当前支持飞书" copy); revisit if a
 * second IdP directory integration ships.
 */
const InvitePersonModal: React.FC<{ visible: boolean; onClose: () => void; onInvited: () => void }> = ({
  visible,
  onClose,
  onInvited,
}) => {
  const { t } = useTranslation();
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [invitingId, setInvitingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    ipcBridge.oneEnterprise.directoryPeople
      .invoke()
      .then(setPeople)
      .catch((e) => Message.error(String(e)))
      .finally(() => setLoading(false));
  }, [visible]);

  const filtered = query.trim()
    ? people.filter((p) => (p.name ?? '').includes(query.trim()) || (p.department ?? '').includes(query.trim()))
    : people;

  const invite = async (person: DirectoryPerson) => {
    setInvitingId(person.externalId);
    try {
      await ipcBridge.oneEnterprise.createCompanyInvite.invoke({
        provider: 'feishu',
        externalId: person.externalId,
        displayName: person.name,
        department: person.department,
        jobTitle: person.jobTitle,
      });
      Message.success(
        t('common.company.inviteSuccess', { defaultValue: '已邀请 {{name}}', name: person.name ?? person.externalId })
      );
      onInvited();
    } catch (e) {
      Message.error(t('common.company.inviteFailed', { defaultValue: '邀请失败' }) + ': ' + String(e));
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <Modal
      title={t('common.company.inviteModalTitle', { defaultValue: '从通讯录邀请成员' })}
      visible={visible}
      onCancel={onClose}
      footer={null}
      style={{ width: 560 }}
    >
      <Input.Search
        placeholder={t('common.company.inviteSearchPlaceholder', { defaultValue: '按姓名或部门搜索' })}
        value={query}
        onChange={setQuery}
        className='mb-12px'
      />
      <div className='max-h-360px overflow-y-auto'>
        <Table
          loading={loading}
          rowKey='externalId'
          data={filtered}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: t('common.company.colName', { defaultValue: '姓名' }),
              dataIndex: 'name',
              render: (v: string | null) => v ?? '—',
            },
            {
              title: t('common.company.colDepartment', { defaultValue: '部门' }),
              dataIndex: 'department',
              render: (v: string | null) => v ?? '—',
            },
            {
              title: '',
              render: (_c, p: DirectoryPerson) => (
                <Button type='text' size='mini' loading={invitingId === p.externalId} onClick={() => void invite(p)}>
                  {t('common.company.inviteAction', { defaultValue: '邀请' })}
                </Button>
              ),
            },
          ]}
        />
      </div>
    </Modal>
  );
};

const MembersTab: React.FC = () => {
  const { t } = useTranslation();
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [memberRows, inviteRows] = await Promise.all([
        ipcBridge.oneEnterprise.companyMembers.invoke(),
        ipcBridge.oneEnterprise.companyInvites.invoke(),
      ]);
      setMembers(memberRows);
      setInvites(inviteRows);
    } catch (e) {
      Message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setRole = async (userId: string, role: string) => {
    try {
      await ipcBridge.oneEnterprise.setCompanyMemberRole.invoke({ userId, role });
      await load();
    } catch (e) {
      Message.error(String(e));
    }
  };

  const revokeInvite = async (inviteId: string) => {
    try {
      await ipcBridge.oneEnterprise.revokeCompanyInvite.invoke({ inviteId });
      await load();
    } catch (e) {
      Message.error(String(e));
    }
  };

  // Previously the only way to remove an in-good-standing member (not yet
  // marked "departed" by a directory sync) was to go find them in some
  // project group's own member list and remove them there — which this
  // page's most natural audience (the company admin, on the page literally
  // titled "成员") would not think to do.
  const removeMember = async (userId: string) => {
    try {
      await ipcBridge.oneEnterprise.removeCompanyMember.invoke({ userId });
      Message.success(t('common.company.memberRemoved', { defaultValue: '已移除成员' }));
      await load();
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'LAST_COMPANY_ADMIN') {
        Message.error(
          t('common.company.removeLastAdmin', {
            defaultValue: '这是当前唯一的企业管理员，请先将至少一名成员提升为管理员，再移除。',
          })
        );
      } else if (isBackendHttpError(e) && e.code === 'FORBIDDEN') {
        Message.error(
          t('common.company.removeSelf', {
            defaultValue: '不能移除自己——如果你想离开，请使用「退出企业」。',
          })
        );
      } else {
        Message.error(t('common.company.removeFailed', { defaultValue: '移除失败' }) + ': ' + String(e));
      }
    }
  };

  return (
    <div>
      <div className='flex justify-end mb-12px'>
        <Button type='primary' size='small' onClick={() => setInviteModalOpen(true)}>
          {t('common.company.inviteButton', { defaultValue: '邀请成员' })}
        </Button>
      </div>
      {invites.length > 0 ? (
        <div className='mb-16px'>
          <div className='text-t-secondary text-13px mb-8px'>
            {t('common.company.pendingInvitesTitle', { defaultValue: '邀请中（尚未登录）' })}
          </div>
          <Table
            rowKey='id'
            data={invites}
            pagination={false}
            columns={[
              {
                title: t('common.company.colName', { defaultValue: '姓名' }),
                render: (_c, i: CompanyInvite) => i.displayName ?? i.externalId,
              },
              {
                title: t('common.company.colDepartment', { defaultValue: '部门' }),
                dataIndex: 'department',
                render: (v: string | null) => v ?? '—',
              },
              {
                title: '',
                render: (_c, i: CompanyInvite) => (
                  <Button type='text' size='mini' status='danger' onClick={() => void revokeInvite(i.id)}>
                    {t('common.company.revokeInvite', { defaultValue: '撤销邀请' })}
                  </Button>
                ),
              },
            ]}
          />
        </div>
      ) : null}
      <Table
        loading={loading}
        rowKey='userId'
        data={members}
        pagination={false}
        columns={[
          {
            title: t('common.company.colName', { defaultValue: '姓名' }),
            render: (_c, m: CompanyMember) => m.displayName ?? m.username ?? m.userId,
          },
          {
            title: t('common.company.colDepartment', { defaultValue: '部门' }),
            dataIndex: 'department',
            render: (v) => v ?? '—',
          },
          {
            title: t('common.company.colRole', { defaultValue: '角色' }),
            render: (_c, m: CompanyMember) => (
              <Select
                value={m.role}
                size='small'
                className='w-120px'
                onChange={(v) => void setRole(m.userId, v)}
                options={[
                  { label: t('common.company.roleAdmin', { defaultValue: '企业管理员' }), value: 'admin' },
                  { label: t('common.company.roleMember', { defaultValue: '成员' }), value: 'member' },
                ]}
              />
            ),
          },
          {
            // T6-4: a member row existing does not mean they can do anything —
            // 'pending' means they were denied a seat and are blocked from every
            // send. Surfacing it here is the only way an admin discovers "someone
            // logged in and got nothing" without them having to report it.
            title: t('common.company.colSeatStatus', { defaultValue: '席位' }),
            render: (_c, m: CompanyMember) =>
              m.seatStatus === 'pending' ? (
                <Tag color='orange' size='small'>
                  {t('common.company.seatPending', { defaultValue: '待分配席位' })}
                </Tag>
              ) : (
                <Tag color='green' size='small'>
                  {t('common.company.seatActive', { defaultValue: '已分配' })}
                </Tag>
              ),
          },
          {
            title: t('common.company.colActions', { defaultValue: '操作' }),
            render: (_c, m: CompanyMember) => (
              <Popconfirm
                title={t('common.company.removeConfirm', {
                  name: m.displayName ?? m.username ?? m.userId,
                  defaultValue: '确认将 {{name}} 移出企业？将同时释放其席位并注销其登录会话。',
                })}
                onOk={() => void removeMember(m.userId)}
              >
                <Button type='text' size='mini' status='danger'>
                  {t('common.company.removeButton', { defaultValue: '移除' })}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
      <InvitePersonModal
        visible={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onInvited={() => {
          setInviteModalOpen(false);
          void load();
        }}
      />
    </div>
  );
};

/**
 * Invite-code management for one company-owned project group. The company
 * admin who created the group is never a member of it, so `oneAdmin.*` (which
 * only ever sees the caller's own tenant) can't reach it — this uses the
 * separate enterprise-scoped routes instead.
 */
const TenantInvitesModal: React.FC<{
  enterpriseId: string;
  tenant: EnterpriseTenant;
  onClose: () => void;
}> = ({ enterpriseId, tenant, onClose }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OrgInvite[]>([]);
  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.oneOrg.enterpriseTenantInvites.invoke({
        enterpriseId,
        tenantId: tenant.tenantId,
      });
      setRows(data ?? []);
    } catch (e) {
      Message.error(t('common.enterprise.loadInvitesFailed', { defaultValue: '加载邀请码失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [enterpriseId, tenant.tenantId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data = await ipcBridge.oneOrg.createEnterpriseTenantInvite.invoke({
        enterpriseId,
        tenantId: tenant.tenantId,
        maxUses: maxUses && maxUses > 0 ? maxUses : undefined,
        expiresInDays: expiresInDays && expiresInDays > 0 ? expiresInDays : undefined,
      });
      Message.success(
        t('common.enterprise.inviteCreated', {
          code: data?.displayCode ?? '',
          defaultValue: '已生成邀请码：{{code}}',
        })
      );
      await load();
    } catch (e) {
      Message.error(t('common.enterprise.inviteCreateFailed', { defaultValue: '生成邀请码失败' }) + ': ' + String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    try {
      await ipcBridge.oneOrg.revokeEnterpriseTenantInvite.invoke({ enterpriseId, tenantId: tenant.tenantId, inviteId });
      Message.success(t('common.enterprise.inviteRevoked', { defaultValue: '邀请码已作废' }));
      await load();
    } catch (e) {
      Message.error(t('common.enterprise.inviteRevokeFailed', { defaultValue: '作废失败' }) + ': ' + String(e));
    }
  };

  return (
    <Modal
      title={`${tenant.name} · ${t('common.company.invitesTitle', { defaultValue: '邀请码' })}`}
      visible
      onCancel={onClose}
      footer={null}
      style={{ width: 640 }}
    >
      <div className='mb-16px flex items-end gap-12px flex-wrap'>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.enterprise.inviteMaxUses', { defaultValue: '最大使用次数（留空不限）' })}
          </div>
          <InputNumber min={1} value={maxUses} onChange={(v) => setMaxUses(v ?? undefined)} style={{ width: 180 }} />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.enterprise.inviteExpiresDays', { defaultValue: '有效期（天，留空永久）' })}
          </div>
          <InputNumber
            min={1}
            value={expiresInDays}
            onChange={(v) => setExpiresInDays(v ?? undefined)}
            style={{ width: 180 }}
          />
        </div>
        <Button type='primary' loading={creating} onClick={() => void handleCreate()}>
          {t('common.enterprise.inviteCreateButton', { defaultValue: '生成邀请码' })}
        </Button>
      </div>
      <Table
        rowKey='id'
        loading={loading}
        data={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        columns={[
          {
            title: t('common.enterprise.inviteColCode', { defaultValue: '邀请码' }),
            render: (_: unknown, record: OrgInvite) => (
              <Typography.Text copyable={{ text: record.code }}>{record.code}</Typography.Text>
            ),
          },
          {
            title: t('common.enterprise.inviteColUses', { defaultValue: '使用次数' }),
            render: (_: unknown, record: OrgInvite) => `${record.use_count} / ${record.max_uses ?? '∞'}`,
          },
          {
            title: t('common.enterprise.inviteColExpires', { defaultValue: '过期时间' }),
            render: (_: unknown, record: OrgInvite) =>
              record.expires_at
                ? new Date(record.expires_at).toLocaleString()
                : t('common.enterprise.inviteNeverExpires', { defaultValue: '永不过期' }),
          },
          {
            title: t('common.enterprise.inviteColStatus', { defaultValue: '状态' }),
            render: (_: unknown, record: OrgInvite) =>
              record.revoked
                ? t('common.enterprise.inviteStatusRevoked', { defaultValue: '已作废' })
                : t('common.enterprise.inviteStatusActive', { defaultValue: '有效' }),
          },
          {
            title: t('common.enterprise.inviteColActions', { defaultValue: '操作' }),
            render: (_: unknown, record: OrgInvite) =>
              record.revoked ? null : (
                <Popconfirm
                  title={t('common.enterprise.inviteRevokeConfirm', {
                    defaultValue: '确认作废此邀请码？作废后不可恢复。',
                  })}
                  onOk={() => void handleRevoke(record.id)}
                >
                  <Button size='small' status='danger'>
                    {t('common.enterprise.inviteRevokeButton', { defaultValue: '作废' })}
                  </Button>
                </Popconfirm>
              ),
          },
        ]}
      />
    </Modal>
  );
};

const ProjectGroupsTab: React.FC<{ enterpriseId: string; onCountChange: (n: number) => void }> = ({
  enterpriseId,
  onCountChange,
}) => {
  const { t } = useTranslation();
  const [tenants, setTenants] = useState<EnterpriseTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [invitesTenant, setInvitesTenant] = useState<EnterpriseTenant | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipcBridge.oneOrg.listEnterpriseTenants.invoke({ enterpriseId });
      setTenants(list);
      onCountChange(list.length);
    } catch (e) {
      Message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [enterpriseId, onCountChange]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await ipcBridge.oneOrg.createEnterpriseTenant.invoke({ enterpriseId, name: name.trim() });
      Modal.success({
        title: t('common.company.groupCreated', { defaultValue: '项目组已创建' }),
        content: t('common.company.groupCreatedHint', {
          code: res.inviteCode,
          defaultValue: '把这个邀请码发给成员即可加入：{{code}}',
        }),
      });
      setName('');
      await load();
    } catch (e) {
      Message.error(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className='flex items-center gap-8px mb-12px'>
        <Input
          value={name}
          onChange={setName}
          placeholder={t('common.company.newGroupPlaceholder', { defaultValue: '新项目组名称' })}
          className='max-w-280px'
        />
        <Button type='primary' loading={creating} onClick={() => void create()}>
          {t('common.company.createGroup', { defaultValue: '新建项目组' })}
        </Button>
      </div>
      <Table
        loading={loading}
        rowKey='tenantId'
        data={tenants}
        pagination={false}
        columns={[
          { title: t('common.company.colGroupName', { defaultValue: '项目组' }), dataIndex: 'name' },
          { title: t('common.company.colGroupMembers', { defaultValue: '成员数' }), dataIndex: 'memberCount' },
          {
            title: t('common.company.colGroupActions', { defaultValue: '操作' }),
            render: (_: unknown, record: EnterpriseTenant) => (
              <Button size='small' onClick={() => setInvitesTenant(record)}>
                {t('common.company.viewInvites', { defaultValue: '邀请码' })}
              </Button>
            ),
          },
        ]}
      />
      {invitesTenant && (
        <TenantInvitesModal enterpriseId={enterpriseId} tenant={invitesTenant} onClose={() => setInvitesTenant(null)} />
      )}
    </div>
  );
};

const CompanyConsole: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { company, isCompanyAdmin, loading, error, refresh } = useCompanyIdentity();
  const { context } = useOrgContext();
  const isSystemAdmin = isSystemAdminRole(context?.role);
  const { isClient: isDeploymentClient } = useDeploymentRole();
  // Client mode without an active browser SSO session sends every governance
  // request (this one included) with no Authorization header, so the server's
  // auth_middleware 401s before the handler ever runs. That failure must not
  // be presented as "no company exists" (`common.company.noneHint`) — this
  // deployment may well have one, we simply couldn't ask.
  const isUnauthenticatedClient = isDeploymentClient && !getEnterpriseSession();
  const [tenantCount, setTenantCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const leaveCompany = useCallback(async () => {
    setLeaving(true);
    try {
      await ipcBridge.oneEnterprise.leaveCompany.invoke();
      Message.success(t('common.company.leaveSuccess', { defaultValue: '已退出企业' }));
      notifyOrgChanged();
      navigate('/guid');
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'LAST_COMPANY_ADMIN') {
        Message.error(
          t('common.company.leaveLastAdmin', {
            defaultValue: '你是当前唯一的企业管理员，请先将至少一名成员提升为管理员，再退出企业。',
          })
        );
      } else {
        Message.error(t('common.company.leaveFailed', { defaultValue: '退出失败' }) + ': ' + String(e));
      }
    } finally {
      setLeaving(false);
    }
  }, [navigate, t]);

  // Seed the project-group count for the overview (ProjectGroupsTab keeps it in
  // sync after a create). Admins only — the list route is admin-gated.
  useEffect(() => {
    if (!company || !isCompanyAdmin) return;
    let alive = true;
    void ipcBridge.oneOrg.listEnterpriseTenants
      .invoke({ enterpriseId: company.companyId })
      .then((list) => {
        if (alive) setTenantCount(list.length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [company, isCompanyAdmin]);

  return (
    <SettingsPageWrapper contentClassName='max-w-1024px'>
      <div className='flex h-full flex-col'>
        <div className='flex items-center justify-between border-b border-border-2 px-16px py-12px'>
          <div className='text-16px font-600 text-t-primary'>
            {t('common.company.title', { defaultValue: '企业管理后台' })}
          </div>
        </div>
        <div className='flex-1 overflow-auto p-16px'>
          {loading ? (
            <Spin loading />
          ) : error && isUnauthenticatedClient ? (
            <div className='flex flex-col gap-12px max-w-560px'>
              <Alert
                type='warning'
                content={t('common.company.clientNotLoggedInHint', {
                  defaultValue:
                    '本机为客户端模式，尚未通过企业 SSO 登录，暂时无法读取企业信息（不代表服务器上没有企业）。请先完成登录。',
                })}
              />
              <Button onClick={() => void navigate('/settings/enterprise-identity')}>
                {t('common.company.goToEnterpriseIdentity', { defaultValue: '前往企业身份登录' })}
              </Button>
            </div>
          ) : error ? (
            <Alert
              type='error'
              title={t('common.company.loadError', { defaultValue: '无法加载企业信息' })}
              content={error}
              action={
                <Button size='small' onClick={() => void refresh()}>
                  {t('common.enterprise.refresh', { defaultValue: '刷新' })}
                </Button>
              }
            />
          ) : !company ? (
            isSystemAdmin ? (
              <SetupCompanyCard onDone={() => void refresh()} />
            ) : (
              <Typography.Paragraph type='secondary'>
                {t('common.company.noneHint', {
                  defaultValue: '本服务器尚未设立企业。请联系系统管理员设立企业后使用。',
                })}
              </Typography.Paragraph>
            )
          ) : !isCompanyAdmin ? (
            <div className='flex flex-col gap-16px'>
              <OverviewTab tenantCount={tenantCount} />
              <Typography.Paragraph type='secondary'>
                {/* `company` is shown even to non-members on a single-company
                    deployment (company_overview() falls back to the
                    deployment's sole company when the caller has no
                    one_enterprise_members row) — viewerRole is null in that
                    case, so "你是本企业成员" would be a false claim. */}
                {company.viewerRole
                  ? t('common.company.notAdminHint', {
                      defaultValue: '你是本企业成员，但不是企业管理员，无法管理成员 / 项目组 / 企业认证。',
                    })
                  : t('common.company.notMemberHint', {
                      name: company.name ?? '',
                      defaultValue:
                        '本服务器已设立企业「{{name}}」，但你尚未加入，以上信息仅供参考。如需加入，请联系企业管理员获取邀请方式。',
                    })}
              </Typography.Paragraph>
              <div className='flex gap-8px'>
                <Button onClick={() => void navigate('/guid')}>{t('common.back', { defaultValue: '返回' })}</Button>
                {/* Only a genuine member (viewerRole set) has anything to
                    leave — the single-company fallback display for a
                    non-member has no membership row to delete. */}
                {company.viewerRole && (
                  <Popconfirm
                    title={t('common.company.leaveConfirm', { defaultValue: '确认退出该企业？' })}
                    onOk={() => void leaveCompany()}
                  >
                    <Button status='danger' loading={leaving}>
                      {t('common.company.leaveButton', { defaultValue: '退出企业' })}
                    </Button>
                  </Popconfirm>
                )}
              </div>
            </div>
          ) : (
            <Tabs defaultActiveTab='overview'>
              <Tabs.TabPane key='overview' title={t('common.company.tabOverview', { defaultValue: '概览' })}>
                <OverviewTab tenantCount={tenantCount} />
              </Tabs.TabPane>
              <Tabs.TabPane key='members' title={t('common.company.tabMembers', { defaultValue: '成员' })}>
                <MembersTab />
              </Tabs.TabPane>
              <Tabs.TabPane key='groups' title={t('common.company.tabGroups', { defaultValue: '项目组' })}>
                <ProjectGroupsTab enterpriseId={company.companyId} onCountChange={setTenantCount} />
              </Tabs.TabPane>
              <Tabs.TabPane key='sso' title={t('common.company.tabSso', { defaultValue: '企业认证' })}>
                <SsoSettingsTab />
              </Tabs.TabPane>
              <Tabs.TabPane key='billing' title={t('common.company.tabBilling')}>
                <BillingTab />
              </Tabs.TabPane>
              {/* T8: the media ledger is enterprise-scoped like billing —
                  what gets generated is company data regardless of which
                  project group the conversation happened in. */}
              <Tabs.TabPane
                key='media-ledger'
                title={t('common.company.tabMediaLedger', { defaultValue: '生成物账本' })}
              >
                <MediaLedgerTab />
              </Tabs.TabPane>
              {/* Model channels are enterprise-scoped like the licence: one
                  credential the company owns, distributed to members without
                  ever leaving the server. */}
              <Tabs.TabPane key='channels' title={t('common.company.tabModelChannels')}>
                <ModelChannelsTab enterpriseId={company.companyId} />
              </Tabs.TabPane>
              {/* Content rules are enterprise-scoped for the same reason as
                  channels: what may be sent to a model is a company decision,
                  even though a rule can be narrowed to one project group. */}
              <Tabs.TabPane key='content-inspection' title={t('common.company.tabContentInspection')}>
                <ContentInspectionTab enterpriseId={company.companyId} />
              </Tabs.TabPane>
              {/* Directory sync is company-scoped for two reasons: the IdP
                  credential it uses is the company's, and the project-group
                  page hides its admin tabs entirely in client deployment mode
                  (`enterprise/index.tsx`'s showAdminTabs), which would make
                  this invisible on exactly the terminals that need it. */}
              <Tabs.TabPane key='directory' title={t('common.company.tabDirectory')}>
                <DirectoryTab />
              </Tabs.TabPane>
              {/* Backup spans the whole deployment, not just this company, so
                  it needs the deployment's own administrator — a company admin
                  is not enough. The backend enforces the same rule. */}
              {isSystemAdmin && (
                <Tabs.TabPane key='backup' title={t('common.company.tabBackup')}>
                  <BackupTab />
                </Tabs.TabPane>
              )}
            </Tabs>
          )}
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default CompanyConsole;
