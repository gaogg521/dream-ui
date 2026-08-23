/**
 * Pipeline management — list / create / edit / delete CI/CD pipelines and
 * view their run history. Uses /api/one/devops/pipelines endpoints.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type {
  Pipeline,
  PipelineRun,
  PipelineRunStatus,
  PipelineStatus,
  PipelineTrigger,
} from '@/common/types/devops/devopsTypes';

const PIPELINE_STATUSES: PipelineStatus[] = ['active', 'disabled'];
const PIPELINE_TRIGGERS: PipelineTrigger[] = ['manual', 'push', 'schedule'];

const PIPELINE_STATUS_COLORS: Record<PipelineStatus, string> = {
  active: 'green',
  disabled: 'gray',
};

const RUN_STATUS_COLORS: Record<PipelineRunStatus, string> = {
  pending: 'gray',
  running: 'arcoblue',
  success: 'green',
  failed: 'red',
  cancelled: 'orange',
};

const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  active: '启用',
  disabled: '停用',
};

const PIPELINE_TRIGGER_LABELS: Record<PipelineTrigger, string> = {
  manual: '手动',
  push: '推送',
  schedule: '定时',
};

const RUN_STATUS_LABELS: Record<PipelineRunStatus, string> = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

type RunsSubPanelProps = { pipeline: Pipeline; readOnly?: boolean };

const RunsSubPanel: React.FC<RunsSubPanelProps> = ({ pipeline, readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [closingRunId, setClosingRunId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await ipcBridge.oneDevops.listPipelineRuns.invoke({ pipelineId: pipeline.id });
      setRuns(next ?? []);
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.loadFailed', { defaultValue: '加载失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setLoading(false);
    }
  }, [pipeline.id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await ipcBridge.oneDevops.createPipelineRun.invoke({ pipelineId: pipeline.id });
      Message.success(t('common.superAssistant.pipelineRunTriggered', { defaultValue: '已触发运行' }));
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setTriggering(false);
    }
  };

  // There is no real execution engine behind a pipeline run — creating one
  // only ever INSERTs a `pending` row (see `create_pipeline_run`). Without
  // this, every triggered run sits at "等待中" forever with no way to close
  // it out, which is indistinguishable from a stuck/broken pipeline. This is
  // deliberately a manual close-out control, not a CI runner: it lets an
  // admin record the outcome of work done elsewhere, nothing more.
  const closeRun = async (run: PipelineRun, status: Extract<PipelineRunStatus, 'success' | 'failed' | 'cancelled'>) => {
    setClosingRunId(run.id);
    try {
      await ipcBridge.oneDevops.updatePipelineRun.invoke({
        pipelineId: pipeline.id,
        id: run.id,
        input: { status, finishedAt: Date.now() },
      });
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setClosingRunId(null);
    }
  };

  const columns = [
    {
      title: t('common.superAssistant.pipelineRunStatus', { defaultValue: '状态' }),
      render: (_: unknown, row: PipelineRun) => (
        <Tag size='small' color={RUN_STATUS_COLORS[row.status]}>
          {RUN_STATUS_LABELS[row.status]}
        </Tag>
      ),
    },
    {
      title: t('common.superAssistant.pipelineRunTriggeredBy', { defaultValue: '触发者' }),
      render: (_: unknown, row: PipelineRun) => row.triggeredBy ?? '-',
    },
    {
      title: t('common.superAssistant.pipelineRunStartedAt', { defaultValue: '开始时间' }),
      render: (_: unknown, row: PipelineRun) => (row.startedAt ? new Date(row.startedAt).toLocaleString() : '-'),
    },
    {
      title: t('common.superAssistant.pipelineRunFinishedAt', { defaultValue: '结束时间' }),
      render: (_: unknown, row: PipelineRun) => (row.finishedAt ? new Date(row.finishedAt).toLocaleString() : '-'),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, row: PipelineRun) => {
              if (row.status !== 'pending' && row.status !== 'running') return '-';
              const busy = closingRunId === row.id;
              return (
                <Space size='mini'>
                  <Button size='mini' status='success' loading={busy} onClick={() => void closeRun(row, 'success')}>
                    {t('common.superAssistant.pipelineRunMarkSuccess', { defaultValue: '标记成功' })}
                  </Button>
                  <Button size='mini' status='danger' loading={busy} onClick={() => void closeRun(row, 'failed')}>
                    {t('common.superAssistant.pipelineRunMarkFailed', { defaultValue: '标记失败' })}
                  </Button>
                  <Button size='mini' loading={busy} onClick={() => void closeRun(row, 'cancelled')}>
                    {t('common.superAssistant.pipelineRunCancel', { defaultValue: '取消' })}
                  </Button>
                </Space>
              );
            },
          },
        ]),
  ];

  return (
    <div className='p-8px'>
      {!readOnly && (
        <div className='flex justify-end mb-8px'>
          <Button type='primary' size='small' loading={triggering} onClick={() => void handleTrigger()}>
            {t('common.superAssistant.triggerPipelineRun', { defaultValue: '触发运行' })}
          </Button>
        </div>
      )}
      <Table rowKey='id' loading={loading} columns={columns} data={runs} pagination={false} />
    </div>
  );
};

type PipelinesSectionProps = { readOnly?: boolean };

const PipelinesSection: React.FC<PipelinesSectionProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Pipeline[]>([]);
  const [editing, setEditing] = useState<Pipeline | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    try {
      const next = await ipcBridge.oneDevops.listPipelines.invoke();
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

  const openEdit = (row: Pipeline) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      description: row.description,
      status: row.status,
      trigger: row.trigger,
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    const values = (await form.validate().catch((): null => null)) as {
      name: string;
      description?: string;
      status?: PipelineStatus;
      trigger?: PipelineTrigger;
    } | null;
    if (!values) return;
    setSaving(true);
    try {
      if (editing) {
        await ipcBridge.oneDevops.updatePipeline.invoke({
          id: editing.id,
          input: {
            name: values.name,
            description: values.description ?? null,
            status: values.status,
            trigger: values.trigger,
          },
        });
      } else {
        await ipcBridge.oneDevops.createPipeline.invoke({
          name: values.name,
          description: values.description || undefined,
          trigger: values.trigger,
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
      await ipcBridge.oneDevops.deletePipeline.invoke({ id });
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
      title: t('common.superAssistant.pipelineName', { defaultValue: '流水线' }),
      render: (_: unknown, record: Pipeline) => record.name,
    },
    {
      title: t('common.superAssistant.pipelineTrigger', { defaultValue: '触发方式' }),
      render: (_: unknown, record: Pipeline) => PIPELINE_TRIGGER_LABELS[record.trigger],
    },
    {
      title: t('common.superAssistant.registries.colStatus', { defaultValue: '状态' }),
      render: (_: unknown, record: Pipeline) => (
        <Tag size='small' color={PIPELINE_STATUS_COLORS[record.status]}>
          {PIPELINE_STATUS_LABELS[record.status]}
        </Tag>
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, record: Pipeline) => (
              <Space size='mini'>
                <Button size='small' onClick={() => openEdit(record)}>
                  {t('common.edit', { defaultValue: '编辑' })}
                </Button>
                <Popconfirm
                  title={t('common.superAssistant.pipelineDeleteConfirm', {
                    defaultValue: '删除流水线及所有运行记录？',
                  })}
                  onOk={() => void handleDelete(record.id)}
                >
                  <Button size='small' status='danger'>
                    {t('common.delete', { defaultValue: '删除' })}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]),
  ];

  return (
    <Card
      title={t('common.superAssistant.pipelinesTitle', { defaultValue: '流水线' })}
      extra={
        !readOnly && (
          <Button type='primary' size='small' onClick={openCreate}>
            {t('common.superAssistant.addPipeline', { defaultValue: '新增流水线' })}
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
        expandedRowRender={(record: Pipeline) => <RunsSubPanel pipeline={record} readOnly={readOnly} />}
      />

      <Modal
        title={
          editing
            ? t('common.superAssistant.editPipeline', { defaultValue: '编辑流水线' })
            : t('common.superAssistant.addPipeline', { defaultValue: '新增流水线' })
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
      >
        <Form form={form} layout='vertical'>
          <Form.Item
            field='name'
            label={t('common.superAssistant.pipelineName', { defaultValue: '流水线名称' })}
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
          <Form.Item field='trigger' label={t('common.superAssistant.pipelineTrigger', { defaultValue: '触发方式' })}>
            <Select defaultValue='manual'>
              {PIPELINE_TRIGGERS.map((tr) => (
                <Select.Option key={tr} value={tr}>
                  {PIPELINE_TRIGGER_LABELS[tr]}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {editing ? (
            <Form.Item field='status' label={t('common.superAssistant.registries.colStatus', { defaultValue: '状态' })}>
              <Select>
                {PIPELINE_STATUSES.map((s) => (
                  <Select.Option key={s} value={s}>
                    {PIPELINE_STATUS_LABELS[s]}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </Card>
  );
};

export default PipelinesSection;
