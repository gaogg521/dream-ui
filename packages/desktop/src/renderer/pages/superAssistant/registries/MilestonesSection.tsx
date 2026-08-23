/**
 * Milestone management — list / create / edit / delete on top of the
 * one-devops milestones endpoints. Requirements link to a milestone via the
 * issue detail drawer; deleting a milestone clears those links server-side.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { Milestone, MilestoneStatus } from '@/common/types/devops/devopsTypes';

/**
 * Coerce the milestone due-date field to epoch ms. Arco's Form.Item binds
 * DatePicker's onChange FIRST arg — the date STRING ("2026-07-14") — as the
 * field value, while an untouched edit keeps the number we set via
 * setFieldsValue. Handle string, number, and Dayjs-like just in case.
 */
function toEpochMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (typeof value === 'object' && 'valueOf' in value) {
    const ms = (value as { valueOf(): unknown }).valueOf();
    return typeof ms === 'number' ? ms : undefined;
  }
  return undefined;
}

const STATUSES: MilestoneStatus[] = ['active', 'completed', 'archived'];
const STATUS_COLORS: Record<MilestoneStatus, string> = {
  active: 'arcoblue',
  completed: 'green',
  archived: 'gray',
};

type MilestonesSectionProps = { readOnly?: boolean };

const MilestonesSection: React.FC<MilestonesSectionProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Milestone[]>([]);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const statusLabel = useCallback(
    (status: MilestoneStatus) =>
      t(`common.superAssistant.milestoneStatus.${status}`, {
        defaultValue: { active: '进行中', completed: '已完成', archived: '已归档' }[status],
      }),
    [t]
  );

  const refresh = useCallback(async () => {
    try {
      const next = await ipcBridge.oneDevops.listMilestones.invoke();
      setRows(next ?? []);
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.loadFailed', { defaultValue: '加载失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalVisible(true);
  };

  const openEdit = (row: Milestone) => {
    setEditing(row);
    form.setFieldsValue({
      title: row.title,
      description: row.description,
      status: row.status,
      dueAt: row.dueAt ?? undefined,
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    const values = (await form.validate().catch((): null => null)) as {
      title: string;
      description?: string;
      status?: MilestoneStatus;
      dueAt?: unknown;
    } | null;
    if (!values) {
      return;
    }
    const dueAtMs = toEpochMs(values.dueAt);
    setSaving(true);
    try {
      if (editing) {
        await ipcBridge.oneDevops.updateMilestone.invoke({
          id: editing.id,
          input: {
            title: values.title,
            description: values.description ?? null,
            status: values.status,
            dueAt: dueAtMs ?? null,
          },
        });
      } else {
        await ipcBridge.oneDevops.createMilestone.invoke({
          title: values.title,
          description: values.description || undefined,
          dueAt: dueAtMs,
        });
      }
      Message.success(t('common.superAssistant.registries.saved', { defaultValue: '已保存' }));
      setModalVisible(false);
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await ipcBridge.oneDevops.deleteMilestone.invoke({ id });
      Message.success(t('common.superAssistant.registries.deleted', { defaultValue: '已删除' }));
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.deleteFailed', { defaultValue: '删除失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    }
  };

  const columns = [
    {
      title: t('common.superAssistant.milestoneTitle', { defaultValue: '里程碑' }),
      render: (_: unknown, record: Milestone) => record.title,
    },
    {
      title: t('common.superAssistant.registries.colStatus', { defaultValue: '状态' }),
      render: (_: unknown, record: Milestone) => (
        <Tag size='small' color={STATUS_COLORS[record.status]}>
          {statusLabel(record.status)}
        </Tag>
      ),
    },
    {
      title: t('common.superAssistant.milestoneDueAt', { defaultValue: '截止' }),
      render: (_: unknown, record: Milestone) => (record.dueAt ? new Date(record.dueAt).toLocaleDateString() : '-'),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, record: Milestone) => (
              <div className='flex gap-6px'>
                <Button size='small' onClick={() => openEdit(record)}>
                  {t('common.edit', { defaultValue: '编辑' })}
                </Button>
                <Popconfirm
                  title={t('common.superAssistant.milestoneDeleteConfirm', {
                    defaultValue: '删除里程碑？关联需求会解除关联',
                  })}
                  onOk={() => void handleDelete(record.id)}
                >
                  <Button size='small' status='danger'>
                    {t('common.delete', { defaultValue: '删除' })}
                  </Button>
                </Popconfirm>
              </div>
            ),
          },
        ]),
  ];

  return (
    <Card
      title={t('common.superAssistant.milestonesTitle', { defaultValue: '里程碑' })}
      extra={
        !readOnly && (
          <Button type='primary' size='small' onClick={openCreate}>
            {t('common.superAssistant.addMilestone', { defaultValue: '新增里程碑' })}
          </Button>
        )
      }
    >
      <Table
        rowKey='id'
        loading={loading}
        columns={columns}
        data={rows}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />

      <Modal
        title={
          editing
            ? t('common.superAssistant.editMilestone', { defaultValue: '编辑里程碑' })
            : t('common.superAssistant.addMilestone', { defaultValue: '新增里程碑' })
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
      >
        <Form form={form} layout='vertical'>
          <Form.Item
            field='title'
            label={t('common.superAssistant.milestoneTitle', { defaultValue: '里程碑' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            field='description'
            label={t('common.superAssistant.registries.colDescription', { defaultValue: '描述' })}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          {editing ? (
            <Form.Item field='status' label={t('common.superAssistant.registries.colStatus', { defaultValue: '状态' })}>
              <Select>
                {STATUSES.map((status) => (
                  <Select.Option key={status} value={status}>
                    {statusLabel(status)}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : null}
          <Form.Item field='dueAt' label={t('common.superAssistant.milestoneDueAt', { defaultValue: '截止' })}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default MilestonesSection;
