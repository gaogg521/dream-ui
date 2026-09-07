/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The member's half of the approval workflow (P2-1).
 *
 * The server has had this for a while — a member submits a request, an
 * administrator approves or rejects it on the console, and the member can read
 * the outcome — and the desktop client could reach none of it. `/api/workflow`
 * appeared nowhere in the app, so someone who needed a resource had to be told
 * to open the console in a browser, and a decision made there never came back
 * to the person who asked. This is that missing surface.
 *
 * Scope is deliberately the member's own queue: submissions and their
 * outcomes. Deciding is an administrator action and stays on the console,
 * where the reviewer already has the context to judge.
 *
 * Terminal-tool approvals do not appear here yet. Those tasks are raised by
 * the enterprise server's own tool gate, and a client-mode member's tools run
 * on their local backend, which has no way to raise or wait on one — see
 * `dream_core_system::tool_security`. When that round trip exists these rows
 * will arrive through the same list, because they are the same task kind.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Message, Modal, Select, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { WorkflowTask } from '@/common/adapter/ipcBridge';
import { isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * The kinds a member can raise themselves.
 *
 * The server accepts six; the other three (`tool`, `security_policy_template`,
 * `node_access`) are raised by the system on the member's behalf and would be
 * meaningless to pick from a form.
 */
const MEMBER_TASK_KINDS = ['resource', 'creation', 'prompt'] as const;

const STATUS_COLOR: Record<string, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
  expired: 'gray',
};

const ApprovalsSettings: React.FC = () => {
  const { t } = useTranslation();
  const enterpriseEnabled = isEnterpriseModeEnabled();

  const [tasks, setTasks] = useState<WorkflowTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [kind, setKind] = useState<string>(MEMBER_TASK_KINDS[0]);
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');

  const refresh = useCallback(async () => {
    if (!enterpriseEnabled) return;
    setLoading(true);
    setError(null);
    try {
      setTasks((await ipcBridge.oneWorkflow.myTasks.invoke()) ?? []);
    } catch (e) {
      setError(friendlyEnterpriseError(e, t));
    } finally {
      setLoading(false);
    }
  }, [enterpriseEnabled, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await ipcBridge.oneWorkflow.createTask.invoke({ kind, title: title.trim(), detail: detail.trim() });
      setComposing(false);
      setTitle('');
      setDetail('');
      Message.success(t('common.approvals.submitted', { defaultValue: '已提交，等待管理员处理。' }));
      await refresh();
    } catch (e) {
      Message.error(friendlyEnterpriseError(e, t));
    } finally {
      setSubmitting(false);
    }
  }, [detail, kind, refresh, t, title]);

  const heading = (
    <div className='flex items-center border-b border-border-2 px-16px py-12px'>
      <div className='text-16px font-600 text-t-primary'>
        {t('common.approvals.title', { defaultValue: '我的审批' })}
      </div>
    </div>
  );

  if (!enterpriseEnabled) {
    return (
      <SettingsPageWrapper contentClassName='max-w-960px'>
        <div className='flex h-full flex-col'>
          {heading}
          <div className='flex-1 overflow-auto p-16px'>
            <Empty
              description={t('common.approvals.notConnected', {
                defaultValue: '审批属于企业版功能。请先在「企业身份」页连接企业服务器。',
              })}
            />
          </div>
        </div>
      </SettingsPageWrapper>
    );
  }

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex h-full flex-col'>
        {heading}
        <div className='flex flex-1 flex-col gap-12px overflow-auto p-16px'>
          <div className='flex items-center justify-between'>
            <span className='text-12px text-t-tertiary'>
              {t('common.approvals.intro', {
                defaultValue: '你提交的申请与管理员的处理结果。审批由管理员在企业管理后台处理。',
              })}
            </span>
            <div className='flex gap-8px'>
              <Button size='small' loading={loading} onClick={() => void refresh()}>
                {t('common.approvals.refresh', { defaultValue: '刷新' })}
              </Button>
              <Button size='small' type='primary' onClick={() => setComposing(true)}>
                {t('common.approvals.newRequest', { defaultValue: '发起申请' })}
              </Button>
            </div>
          </div>

          {error ? <div className='text-12px text-danger-6'>{error}</div> : null}

          {tasks.length === 0 && !loading ? (
            <Empty description={t('common.approvals.empty', { defaultValue: '还没有提交过申请。' })} />
          ) : (
            <Table
              size='small'
              rowKey='id'
              loading={loading}
              pagination={false}
              data={tasks}
              columns={[
                {
                  title: t('common.approvals.colTitle', { defaultValue: '申请' }),
                  dataIndex: 'title',
                },
                {
                  title: t('common.approvals.colKind', { defaultValue: '类型' }),
                  dataIndex: 'kind',
                  width: 110,
                  render: (kindValue: string) =>
                    t(`common.approvals.kind.${kindValue}` as 'common.approvals.kind.resource', {
                      defaultValue: kindValue,
                    }),
                },
                {
                  title: t('common.approvals.colStatus', { defaultValue: '状态' }),
                  dataIndex: 'status',
                  width: 110,
                  render: (status: string) => (
                    <Tag size='small' color={STATUS_COLOR[status] ?? 'gray'}>
                      {t(`common.approvals.status.${status}` as 'common.approvals.status.pending', {
                        defaultValue: status,
                      })}
                    </Tag>
                  ),
                },
                {
                  // The reviewer's note is the whole point of reading this page
                  // after a rejection: "no" without a reason sends the member
                  // back to ask a human anyway.
                  title: t('common.approvals.colNote', { defaultValue: '处理意见' }),
                  dataIndex: 'note',
                  render: (note: string | null) => note || '—',
                },
                {
                  title: t('common.approvals.colCreatedAt', { defaultValue: '提交时间' }),
                  dataIndex: 'createdAt',
                  width: 170,
                  render: (createdAt: number) => new Date(createdAt).toLocaleString(),
                },
              ]}
            />
          )}
        </div>
      </div>

      <Modal
        visible={composing}
        title={t('common.approvals.newRequest', { defaultValue: '发起申请' })}
        onCancel={() => setComposing(false)}
        onOk={() => void submit()}
        confirmLoading={submitting}
        okButtonProps={{ disabled: !title.trim() }}
      >
        <div className='flex flex-col gap-12px'>
          <Select value={kind} onChange={setKind}>
            {MEMBER_TASK_KINDS.map((value) => (
              <Select.Option key={value} value={value}>
                {t(`common.approvals.kind.${value}` as 'common.approvals.kind.resource', { defaultValue: value })}
              </Select.Option>
            ))}
          </Select>
          <Input
            value={title}
            onChange={setTitle}
            placeholder={t('common.approvals.titlePlaceholder', { defaultValue: '一句话说明你要申请什么' })}
          />
          <Input.TextArea
            value={detail}
            onChange={setDetail}
            rows={4}
            placeholder={t('common.approvals.detailPlaceholder', {
              defaultValue: '补充说明（可选）：用途、时限、涉及的资源',
            })}
          />
        </div>
      </Modal>
    </SettingsPageWrapper>
  );
};

export default ApprovalsSettings;
