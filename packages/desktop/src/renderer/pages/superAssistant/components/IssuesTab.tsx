/**
 * Issues board — requirements kanban backed by the one-devops crate.
 *
 * Rebuild of the 1one IssuesWorkbench: board columns by status, issue detail
 * with status/priority transitions, comments, create/delete. Orchestration
 * actions target the v2 one-employee model: assign + manual dispatch (派活, L1),
 * LLM breakdown into child requirements (自动拆解, L2), and per-requirement
 * autopilot that auto-dispatches on assign / pre-dev status (自动派活, L3).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Switch,
  Tag,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  Milestone,
  RequirementComment,
  RequirementNode,
  RequirementPriority,
  RequirementStatus,
  RequirementType,
  UpdateRequirementInput,
} from '@/common/types/devops/devopsTypes';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';
import type { CollaborationContext } from '../hooks/useCollaborationContext';
import CollaborationContextPanel from './CollaborationContextPanel';

const STATUSES: RequirementStatus[] = ['backlog', 'planning', 'developing', 'testing', 'completed'];
const TYPES: RequirementType[] = ['epic', 'feature', 'story', 'bug', 'task'];
const PRIORITIES: RequirementPriority[] = ['low', 'medium', 'high', 'urgent'];

const PRIORITY_COLORS: Record<RequirementPriority, string> = {
  low: 'gray',
  medium: 'arcoblue',
  high: 'orange',
  urgent: 'red',
};

const TYPE_COLORS: Record<RequirementType, string> = {
  epic: 'purple',
  feature: 'arcoblue',
  story: 'cyan',
  bug: 'red',
  task: 'gray',
};

function flatten(nodes: RequirementNode[]): RequirementNode[] {
  const out: RequirementNode[] = [];
  const walk = (list: RequirementNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

type IssuesTabProps = {
  collaborationContext: CollaborationContext;
  // Shared, auto-refreshing digital-employee list from the parent page. Do NOT
  // fetch independently here: a one-shot mount fetch goes stale after a
  // create/delete elsewhere (the parent's useDigitalEmployees refreshes on
  // those), which is why newly-created employees didn't show in the dropdown.
  employees: PersonalAgent[];
  onOpenRegistries?: () => void;
};

const IssuesTab: React.FC<IssuesTabProps> = ({ collaborationContext, employees, onOpenRegistries }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState<RequirementNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<RequirementComment[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [breakingDown, setBreakingDown] = useState(false);
  const [form] = Form.useForm();

  const issues = useMemo(() => flatten(tree), [tree]);
  const selected = useMemo(() => issues.find((issue) => issue.id === selectedId) ?? null, [issues, selectedId]);
  const columns = useMemo(
    () =>
      STATUSES.map((status) => ({
        status,
        items: issues.filter((issue) => issue.status === status),
      })),
    [issues]
  );

  const refresh = useCallback(async () => {
    try {
      const next = await ipcBridge.oneDevops.requirementsTree.invoke();
      setTree(next ?? []);
    } catch (error) {
      Message.error(
        t('common.superAssistant.issuesLoadFailed', { defaultValue: '看板加载失败' }) + ': ' + String(error)
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    ipcBridge.oneDevops.listMilestones
      .invoke()
      .then((rows) => setMilestones(rows ?? []))
      .catch(() => setMilestones([]));
  }, []);

  const employeeName = useCallback(
    (id: string | null) => (id ? (employees.find((e) => e.id === id)?.name ?? id) : null),
    [employees]
  );

  const refreshComments = useCallback(async (issueId: string) => {
    try {
      const rows = await ipcBridge.oneDevops.listRequirementComments.invoke({ id: issueId });
      setComments(rows ?? []);
    } catch {
      setComments([]);
    }
  }, []);

  useEffect(() => {
    setComments([]);
    setCommentDraft('');
    if (selectedId) {
      void refreshComments(selectedId);
    }
  }, [refreshComments, selectedId]);

  const updateIssue = useCallback(
    async (id: string, input: UpdateRequirementInput): Promise<void> => {
      try {
        await ipcBridge.oneDevops.updateRequirement.invoke({ id, input });
        await refresh();
      } catch (error) {
        Message.error(
          t('common.superAssistant.issueUpdateFailed', { defaultValue: '更新失败' }) + ': ' + String(error)
        );
      }
    },
    [refresh, t]
  );

  const handleCreate = useCallback(async () => {
    const values = (await form.validate().catch((): null => null)) as {
      subject: string;
      type: RequirementType;
      priority: RequirementPriority;
      description?: string;
    } | null;
    if (!values) {
      return;
    }
    setCreating(true);
    try {
      await ipcBridge.oneDevops.createRequirement.invoke({
        subject: values.subject,
        type: values.type,
        priority: values.priority,
        description: values.description || undefined,
      });
      Message.success(t('common.superAssistant.issueCreated', { defaultValue: '已创建' }));
      setCreateVisible(false);
      form.resetFields();
      await refresh();
    } catch (error) {
      Message.error(t('common.superAssistant.issueCreateFailed', { defaultValue: '创建失败' }) + ': ' + String(error));
    } finally {
      setCreating(false);
    }
  }, [form, refresh, t]);

  const handleDelete = useCallback(async () => {
    if (!selected) {
      return;
    }
    try {
      await ipcBridge.oneDevops.deleteRequirement.invoke({ id: selected.id });
      Message.success(t('common.superAssistant.issueDeleted', { defaultValue: '已删除' }));
      setSelectedId(null);
      await refresh();
    } catch (error) {
      Message.error(t('common.superAssistant.issueDeleteFailed', { defaultValue: '删除失败' }) + ': ' + String(error));
    }
  }, [refresh, selected, t]);

  const handleDispatch = useCallback(async () => {
    if (!selected || !selected.assignedTo) {
      return;
    }
    setDispatching(true);
    try {
      await ipcBridge.oneDevops.dispatchRequirement.invoke({ id: selected.id });
      Message.success(t('common.superAssistant.dispatchStarted', { defaultValue: '已派发给数字员工，运行中' }));
      await refresh();
      await refreshComments(selected.id);
    } catch (error) {
      Message.error(t('common.superAssistant.dispatchFailed', { defaultValue: '派发失败' }) + ': ' + String(error));
    } finally {
      setDispatching(false);
    }
  }, [refresh, refreshComments, selected, t]);

  const handleBreakdown = useCallback(async () => {
    if (!selected || !selected.assignedTo) {
      return;
    }
    setBreakingDown(true);
    try {
      const result = await ipcBridge.oneDevops.breakdownRequirement.invoke({ id: selected.id });
      Message.success(
        t('common.superAssistant.breakdownDone', {
          defaultValue: '已拆解为 {{count}} 条子需求',
          count: result.created.length,
        })
      );
      await refresh();
      await refreshComments(selected.id);
    } catch (error) {
      Message.error(t('common.superAssistant.breakdownFailed', { defaultValue: '拆解失败' }) + ': ' + String(error));
    } finally {
      setBreakingDown(false);
    }
  }, [refresh, refreshComments, selected, t]);

  const handleAddComment = useCallback(async () => {
    if (!selected || !commentDraft.trim()) {
      return;
    }
    try {
      await ipcBridge.oneDevops.createRequirementComment.invoke({ id: selected.id, body: commentDraft.trim() });
      setCommentDraft('');
      await refreshComments(selected.id);
    } catch (error) {
      Message.error(t('common.superAssistant.commentFailed', { defaultValue: '评论失败' }) + ': ' + String(error));
    }
  }, [commentDraft, refreshComments, selected, t]);

  const statusLabel = useCallback(
    (status: RequirementStatus) =>
      t(`common.superAssistant.issueStatus.${status}`, {
        defaultValue: {
          backlog: '待办',
          planning: '规划中',
          developing: '开发中',
          testing: '测试中',
          completed: '已完成',
        }[status],
      }),
    [t]
  );

  return (
    <div className='flex flex-col gap-12px'>
      <Card>
        <CollaborationContextPanel
          issueSubject={selected?.subject ?? null}
          context={collaborationContext}
          onOpenRegistries={onOpenRegistries}
        />
      </Card>

      <div className='flex items-center justify-between'>
        <div className='text-13px text-t-secondary'>
          {t('common.superAssistant.issuesBoardHint', {
            defaultValue: '共 {{count}} 个 Issue',
            count: issues.length,
          })}
        </div>
        <Button type='primary' size='small' onClick={() => setCreateVisible(true)}>
          {t('common.superAssistant.createIssue', { defaultValue: '新建 Issue' })}
        </Button>
      </div>

      <Spin loading={loading}>
        {issues.length === 0 && !loading ? (
          <Empty
            description={t('common.superAssistant.issuesEmpty', {
              defaultValue: '还没有 Issue，点击「新建 Issue」开始',
            })}
          />
        ) : (
          <div className='grid grid-cols-5 gap-8px overflow-x-auto'>
            {columns.map((column) => (
              <div key={column.status} className='min-w-160px rounded-8px bg-fill-1 p-8px'>
                <div className='mb-8px flex items-center justify-between'>
                  <span className='text-12px font-600'>{statusLabel(column.status)}</span>
                  <span className='text-11px text-t-tertiary'>{column.items.length}</span>
                </div>
                <div className='flex flex-col gap-6px'>
                  {column.items.map((issue) => (
                    <Card key={issue.id} hoverable className='cursor-pointer' onClick={() => setSelectedId(issue.id)}>
                      <div className='mb-4px text-13px'>{issue.subject}</div>
                      <div className='flex flex-wrap gap-4px'>
                        <Tag size='small' color={TYPE_COLORS[issue.type] ?? 'gray'}>
                          {issue.type}
                        </Tag>
                        <Tag size='small' color={PRIORITY_COLORS[issue.priority] ?? 'gray'}>
                          {issue.priority}
                        </Tag>
                        {issue.assignedTo ? (
                          <Tag size='small' color='green'>
                            {employeeName(issue.assignedTo)}
                          </Tag>
                        ) : null}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Spin>

      <Drawer
        width={420}
        visible={Boolean(selected)}
        title={selected?.subject}
        onCancel={() => setSelectedId(null)}
        footer={null}
      >
        {selected ? (
          <div className='flex flex-col gap-12px'>
            <div className='flex flex-wrap items-center gap-8px'>
              <Select
                size='small'
                style={{ width: 120 }}
                value={selected.status}
                onChange={(value) => void updateIssue(selected.id, { status: value as RequirementStatus })}
              >
                {STATUSES.map((status) => (
                  <Select.Option key={status} value={status}>
                    {statusLabel(status)}
                  </Select.Option>
                ))}
              </Select>
              <Select
                size='small'
                style={{ width: 100 }}
                value={selected.priority}
                onChange={(value) => void updateIssue(selected.id, { priority: value as RequirementPriority })}
              >
                {PRIORITIES.map((priority) => (
                  <Select.Option key={priority} value={priority}>
                    {priority}
                  </Select.Option>
                ))}
              </Select>
              <Popconfirm
                title={t('common.superAssistant.issueDeleteConfirm', { defaultValue: '删除该 Issue 及其子项？' })}
                onOk={() => void handleDelete()}
              >
                <Button size='small' status='danger'>
                  {t('common.delete', { defaultValue: '删除' })}
                </Button>
              </Popconfirm>
            </div>

            <div className='flex flex-wrap items-center gap-8px rounded-6px bg-fill-1 p-8px'>
              <span className='text-12px text-t-secondary'>
                {t('common.superAssistant.assignEmployee', { defaultValue: '数字员工' })}
              </span>
              <Select
                size='small'
                allowClear
                style={{ width: 160 }}
                placeholder={t('common.superAssistant.assignPlaceholder', { defaultValue: '未指派' })}
                value={selected.assignedTo ?? undefined}
                onChange={(value) =>
                  void updateIssue(selected.id, { assignedTo: (value as string | undefined) ?? null })
                }
                notFoundContent={t('common.superAssistant.noEmployees', { defaultValue: '还没有数字员工' })}
              >
                {employees.map((employee) => (
                  <Select.Option key={employee.id} value={employee.id}>
                    {employee.name}
                  </Select.Option>
                ))}
              </Select>
              <Button
                size='small'
                type='primary'
                loading={dispatching}
                disabled={!selected.assignedTo}
                onClick={() => void handleDispatch()}
              >
                {t('common.superAssistant.dispatch', { defaultValue: '派活' })}
              </Button>
              <Button
                size='small'
                loading={breakingDown}
                disabled={!selected.assignedTo}
                onClick={() => void handleBreakdown()}
              >
                {t('common.superAssistant.breakdown', { defaultValue: '自动拆解' })}
              </Button>
              <span className='ml-auto flex items-center gap-4px text-12px text-t-secondary'>
                {t('common.superAssistant.autopilot', { defaultValue: '自动派活' })}
                <Switch
                  size='small'
                  checked={selected.autopilot}
                  onChange={(value) => void updateIssue(selected.id, { autopilot: value })}
                />
              </span>
            </div>

            <div className='flex flex-wrap items-center gap-8px rounded-6px bg-fill-1 p-8px'>
              <span className='text-12px text-t-secondary'>
                {t('common.superAssistant.milestoneTitle', { defaultValue: '里程碑' })}
              </span>
              <Select
                size='small'
                allowClear
                style={{ width: 200 }}
                placeholder={t('common.superAssistant.milestoneUnset', { defaultValue: '未关联' })}
                value={selected.milestoneId ?? undefined}
                onChange={(value) =>
                  void updateIssue(selected.id, { milestoneId: (value as string | undefined) ?? null })
                }
                notFoundContent={t('common.superAssistant.noMilestones', { defaultValue: '还没有里程碑' })}
              >
                {milestones.map((milestone) => (
                  <Select.Option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </Select.Option>
                ))}
              </Select>
            </div>

            {selected.description ? (
              <div className='whitespace-pre-wrap rounded-6px bg-fill-1 p-8px text-12px text-t-secondary'>
                {selected.description}
              </div>
            ) : null}

            <div className='text-12px text-t-tertiary'>
              {t('common.superAssistant.issueMeta', {
                defaultValue: '创建人 {{creator}} · 更新于 {{time}}',
                creator: selected.creatorName || selected.creatorId,
                time: new Date(selected.updatedAt).toLocaleString(),
              })}
            </div>

            <div className='border-t border-border-2 pt-8px'>
              <div className='mb-8px text-13px font-600'>
                {t('common.superAssistant.comments', { defaultValue: '评论' })} ({comments.length})
              </div>
              <div className='flex max-h-240px flex-col gap-8px overflow-y-auto'>
                {comments.map((comment) => (
                  <div key={comment.id} className='rounded-6px bg-fill-1 p-8px'>
                    <div className='mb-2px text-11px text-t-tertiary'>
                      {comment.authorName} · {new Date(comment.createdAt).toLocaleString()}
                    </div>
                    <div className='whitespace-pre-wrap text-12px'>{comment.body}</div>
                  </div>
                ))}
              </div>
              <div className='mt-8px flex gap-6px'>
                <Input
                  size='small'
                  value={commentDraft}
                  onChange={setCommentDraft}
                  placeholder={t('common.superAssistant.commentPlaceholder', { defaultValue: '写点什么…' })}
                  onPressEnter={() => void handleAddComment()}
                />
                <Button size='small' type='primary' onClick={() => void handleAddComment()}>
                  {t('common.send', { defaultValue: '发送' })}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal
        title={t('common.superAssistant.createIssue', { defaultValue: '新建 Issue' })}
        visible={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={creating}
      >
        <Form form={form} layout='vertical' initialValues={{ type: 'task', priority: 'medium' }}>
          <Form.Item
            field='subject'
            label={t('common.superAssistant.issueSubject', { defaultValue: '标题' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input placeholder={t('common.superAssistant.issueSubjectPlaceholder', { defaultValue: '要做什么？' })} />
          </Form.Item>
          <Form.Item field='type' label={t('common.superAssistant.issueType', { defaultValue: '类型' })}>
            <Select>
              {TYPES.map((type) => (
                <Select.Option key={type} value={type}>
                  {type}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item field='priority' label={t('common.superAssistant.issuePriority', { defaultValue: '优先级' })}>
            <Select>
              {PRIORITIES.map((priority) => (
                <Select.Option key={priority} value={priority}>
                  {priority}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item field='description' label={t('common.superAssistant.issueDescription', { defaultValue: '描述' })}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default IssuesTab;
