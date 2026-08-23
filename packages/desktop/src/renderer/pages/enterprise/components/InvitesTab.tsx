/**
 * Enterprise invites tab — create / list / revoke invite codes.
 * Ported from 1one EnterpriseInvitesSection, re-wired to /api/one/admin/invites.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, InputNumber, Message, Modal, Popconfirm, Table, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { OrgInvite } from '@/common/types/org/orgTypes';

type InvitesTabProps = {
  /** Read-only member view (client-mode terminal): list only, no create/revoke. */
  readOnly?: boolean;
};

const InvitesTab: React.FC<InvitesTabProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OrgInvite[]>([]);
  const [creating, setCreating] = useState(false);
  const [maxUses, setMaxUses] = useState<number | undefined>(undefined);
  const [expiresInDays, setExpiresInDays] = useState<number | undefined>(7);
  // P2-4 onboarding: bulk generation.
  const [bulkModalVisible, setBulkModalVisible] = useState(false);
  const [bulkCount, setBulkCount] = useState<number | undefined>(10);
  const [bulkCreating, setBulkCreating] = useState(false);
  // P2-4 onboarding: send-by-email (reserved — reports not-configured until
  // an operator wires up SMTP).
  const [emailModalInviteId, setEmailModalInviteId] = useState<string | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = readOnly ? await ipcBridge.oneOrg.invites.invoke() : await ipcBridge.oneAdmin.listInvites.invoke();
      setRows(data ?? []);
    } catch (e) {
      Message.error(t('common.enterprise.loadInvitesFailed', { defaultValue: '加载邀请码失败' }) + ': ' + String(e));
    } finally {
      setLoading(false);
    }
  }, [t, readOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data = await ipcBridge.oneAdmin.createInvite.invoke({
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
      await ipcBridge.oneAdmin.revokeInvite.invoke({ inviteId });
      Message.success(t('common.enterprise.inviteRevoked', { defaultValue: '邀请码已作废' }));
      await load();
    } catch (e) {
      Message.error(t('common.enterprise.inviteRevokeFailed', { defaultValue: '作废失败' }) + ': ' + String(e));
    }
  };

  // P2-4 onboarding: generate many codes at once for batch onboarding.
  const handleBulkCreate = async () => {
    const count = bulkCount && bulkCount > 0 ? bulkCount : 0;
    if (!count) return;
    setBulkCreating(true);
    try {
      const created = await ipcBridge.oneAdmin.createInvitesBulk.invoke({ count, maxUses, expiresInDays });
      Message.success(
        t('common.enterprise.inviteBulkCreated', {
          count: created?.length ?? count,
          defaultValue: '已生成 {{count}} 个邀请码',
        })
      );
      setBulkModalVisible(false);
      await load();
    } catch (e) {
      Message.error(t('common.enterprise.inviteCreateFailed', { defaultValue: '生成邀请码失败' }) + ': ' + String(e));
    } finally {
      setBulkCreating(false);
    }
  };

  // P2-4 onboarding: send-by-email is a reserved seam — with no SMTP wired the
  // result reports "not configured" rather than silently doing nothing.
  const handleSendEmail = async () => {
    if (!emailModalInviteId || !emailTo.trim()) return;
    setSendingEmail(true);
    try {
      const result = await ipcBridge.oneAdmin.sendInviteEmail.invoke({
        inviteId: emailModalInviteId,
        to: emailTo.trim(),
      });
      if (result.status === 'sent') {
        Message.success(result.message);
        setEmailModalInviteId(null);
        setEmailTo('');
      } else {
        Message.info(result.message);
      }
    } catch (e) {
      Message.error(t('common.enterprise.inviteEmailFailed', { defaultValue: '发送失败' }) + ': ' + String(e));
    } finally {
      setSendingEmail(false);
    }
  };

  const columns = [
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
    ...(readOnly
      ? []
      : [
          {
            title: t('common.enterprise.inviteColActions', { defaultValue: '操作' }),
            render: (_: unknown, record: OrgInvite) =>
              record.revoked ? null : (
                <div className='flex gap-6px'>
                  <Button
                    size='small'
                    onClick={() => {
                      setEmailModalInviteId(record.id);
                      setEmailTo('');
                    }}
                  >
                    {t('common.enterprise.inviteSendEmailButton', { defaultValue: '发送邮件' })}
                  </Button>
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
                </div>
              ),
          },
        ]),
  ];

  return (
    <div>
      {!readOnly && (
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
          <Button type='primary' loading={creating} onClick={handleCreate}>
            {t('common.enterprise.inviteCreateButton', { defaultValue: '生成邀请码' })}
          </Button>
          <Button onClick={() => setBulkModalVisible(true)}>
            {t('common.enterprise.inviteBulkCreateButton', { defaultValue: '批量生成' })}
          </Button>
        </div>
      )}
      <Table
        rowKey='id'
        loading={loading}
        columns={columns}
        data={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />

      <Modal
        title={t('common.enterprise.inviteBulkCreateButton', { defaultValue: '批量生成' })}
        visible={bulkModalVisible}
        onCancel={() => setBulkModalVisible(false)}
        onOk={() => void handleBulkCreate()}
        confirmLoading={bulkCreating}
      >
        <div className='mb-8px text-12px text-t-tertiary'>
          {t('common.enterprise.inviteBulkHint', {
            defaultValue: '一次生成多个邀请码，用于批量邀请新成员（最多 100 个）。沿用上方的使用次数/有效期设置。',
          })}
        </div>
        <div className='text-t-secondary text-12px mb-4px'>
          {t('common.enterprise.inviteBulkCount', { defaultValue: '数量' })}
        </div>
        <InputNumber
          min={1}
          max={100}
          value={bulkCount}
          onChange={(v) => setBulkCount(v ?? undefined)}
          style={{ width: 180 }}
        />
      </Modal>

      <Modal
        title={t('common.enterprise.inviteSendEmailButton', { defaultValue: '发送邮件' })}
        visible={emailModalInviteId != null}
        onCancel={() => setEmailModalInviteId(null)}
        onOk={() => void handleSendEmail()}
        confirmLoading={sendingEmail}
      >
        <div className='mb-8px text-12px text-t-tertiary'>
          {t('common.enterprise.inviteEmailHint', {
            defaultValue: '未配置 SMTP 前，发送会提示"未配置"——先在下方"批量邀请"页设置 SMTP。',
          })}
        </div>
        <Input
          value={emailTo}
          onChange={setEmailTo}
          placeholder={t('common.enterprise.inviteEmailPlaceholder', { defaultValue: '收件人邮箱' })}
        />
      </Modal>
    </div>
  );
};

export default InvitesTab;
