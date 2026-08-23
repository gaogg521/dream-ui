/**
 * Test plan management — list / create / edit / delete test plans and their
 * test cases. Uses the one-devops /api/one/devops/test-plans endpoints.
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
import type { TestCase, TestCaseStatus, TestPlan, TestPlanStatus } from '@/common/types/devops/devopsTypes';

const PLAN_STATUSES: TestPlanStatus[] = ['draft', 'active', 'completed', 'archived'];
const CASE_STATUSES: TestCaseStatus[] = ['pending', 'passed', 'failed', 'blocked', 'skipped'];

const PLAN_STATUS_COLORS: Record<TestPlanStatus, string> = {
  draft: 'gray',
  active: 'arcoblue',
  completed: 'green',
  archived: 'gray',
};

const CASE_STATUS_COLORS: Record<TestCaseStatus, string> = {
  pending: 'gray',
  passed: 'green',
  failed: 'red',
  blocked: 'orange',
  skipped: 'gray',
};

const PLAN_STATUS_LABELS: Record<TestPlanStatus, string> = {
  draft: '草稿',
  active: '执行中',
  completed: '已完成',
  archived: '已归档',
};

const CASE_STATUS_LABELS: Record<TestCaseStatus, string> = {
  pending: '待执行',
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
  skipped: '跳过',
};

type CasesSubPanelProps = { plan: TestPlan; readOnly?: boolean };

const CasesSubPanel: React.FC<CasesSubPanelProps> = ({ plan, readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await ipcBridge.oneDevops.listTestCases.invoke({ planId: plan.id });
      setCases(next ?? []);
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.loadFailed', { defaultValue: '加载失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    } finally {
      setLoading(false);
    }
  }, [plan.id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalVisible(true);
  };

  const openEdit = (row: TestCase) => {
    setEditing(row);
    form.setFieldsValue({
      title: row.title,
      status: row.status,
      description: row.description,
      steps: row.steps,
      expected: row.expected,
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    const values = (await form.validate().catch((): null => null)) as {
      title: string;
      status?: TestCaseStatus;
      description?: string;
      steps?: string;
      expected?: string;
    } | null;
    if (!values) return;
    setSaving(true);
    try {
      if (editing) {
        await ipcBridge.oneDevops.updateTestCase.invoke({
          planId: plan.id,
          id: editing.id,
          input: {
            title: values.title,
            status: values.status,
            description: values.description ?? null,
            steps: values.steps ?? null,
            expected: values.expected ?? null,
          },
        });
      } else {
        await ipcBridge.oneDevops.createTestCase.invoke({
          planId: plan.id,
          input: {
            title: values.title,
            description: values.description || undefined,
            steps: values.steps || undefined,
            expected: values.expected || undefined,
          },
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

  const handleDelete = async (caseId: string) => {
    try {
      await ipcBridge.oneDevops.deleteTestCase.invoke({ planId: plan.id, id: caseId });
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
      title: t('common.superAssistant.testCase', { defaultValue: '用例' }),
      render: (_: unknown, row: TestCase) => row.title,
    },
    {
      title: t('common.superAssistant.registries.colStatus', { defaultValue: '状态' }),
      render: (_: unknown, row: TestCase) => (
        <Tag size='small' color={CASE_STATUS_COLORS[row.status]}>
          {CASE_STATUS_LABELS[row.status]}
        </Tag>
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, row: TestCase) => (
              <Space size='mini'>
                <Button size='mini' onClick={() => openEdit(row)}>
                  {t('common.edit', { defaultValue: '编辑' })}
                </Button>
                <Popconfirm
                  title={t('common.superAssistant.testCaseDeleteConfirm', { defaultValue: '删除用例？' })}
                  onOk={() => void handleDelete(row.id)}
                >
                  <Button size='mini' status='danger'>
                    {t('common.delete', { defaultValue: '删除' })}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]),
  ];

  return (
    <div className='p-8px'>
      {!readOnly && (
        <div className='flex justify-end mb-8px'>
          <Button type='primary' size='small' onClick={openCreate}>
            {t('common.superAssistant.addTestCase', { defaultValue: '新增用例' })}
          </Button>
        </div>
      )}
      <Table rowKey='id' loading={loading} columns={columns} data={cases} pagination={false} />

      <Modal
        title={
          editing
            ? t('common.superAssistant.editTestCase', { defaultValue: '编辑用例' })
            : t('common.superAssistant.addTestCase', { defaultValue: '新增用例' })
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
      >
        <Form form={form} layout='vertical'>
          <Form.Item
            field='title'
            label={t('common.superAssistant.testCaseTitle', { defaultValue: '用例标题' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input />
          </Form.Item>
          {editing ? (
            <Form.Item field='status' label={t('common.superAssistant.registries.colStatus', { defaultValue: '状态' })}>
              <Select>
                {CASE_STATUSES.map((s) => (
                  <Select.Option key={s} value={s}>
                    {CASE_STATUS_LABELS[s]}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : null}
          <Form.Item
            field='description'
            label={t('common.superAssistant.registries.colDescription', { defaultValue: '描述' })}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item field='steps' label={t('common.superAssistant.testCaseSteps', { defaultValue: '步骤（JSON）' })}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item field='expected' label={t('common.superAssistant.testCaseExpected', { defaultValue: '预期结果' })}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

type TestPlansSectionProps = { readOnly?: boolean };

const TestPlansSection: React.FC<TestPlansSectionProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TestPlan[]>([]);
  const [editing, setEditing] = useState<TestPlan | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback(async () => {
    try {
      const next = await ipcBridge.oneDevops.listTestPlans.invoke();
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

  const openEdit = (row: TestPlan) => {
    setEditing(row);
    form.setFieldsValue({
      title: row.title,
      description: row.description,
      status: row.status,
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    const values = (await form.validate().catch((): null => null)) as {
      title: string;
      description?: string;
      status?: TestPlanStatus;
    } | null;
    if (!values) return;
    setSaving(true);
    try {
      if (editing) {
        await ipcBridge.oneDevops.updateTestPlan.invoke({
          id: editing.id,
          input: {
            title: values.title,
            description: values.description ?? null,
            status: values.status,
          },
        });
      } else {
        await ipcBridge.oneDevops.createTestPlan.invoke({
          title: values.title,
          description: values.description || undefined,
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
      await ipcBridge.oneDevops.deleteTestPlan.invoke({ id });
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
      title: t('common.superAssistant.testPlanTitle', { defaultValue: '测试计划' }),
      render: (_: unknown, record: TestPlan) => record.title,
    },
    {
      title: t('common.superAssistant.registries.colStatus', { defaultValue: '状态' }),
      render: (_: unknown, record: TestPlan) => (
        <Tag size='small' color={PLAN_STATUS_COLORS[record.status]}>
          {PLAN_STATUS_LABELS[record.status]}
        </Tag>
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, record: TestPlan) => (
              <Space size='mini'>
                <Button size='small' onClick={() => openEdit(record)}>
                  {t('common.edit', { defaultValue: '编辑' })}
                </Button>
                <Popconfirm
                  title={t('common.superAssistant.testPlanDeleteConfirm', {
                    defaultValue: '删除测试计划及所有用例？',
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
      title={t('common.superAssistant.testPlansTitle', { defaultValue: '测试计划' })}
      extra={
        !readOnly && (
          <Button type='primary' size='small' onClick={openCreate}>
            {t('common.superAssistant.addTestPlan', { defaultValue: '新增计划' })}
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
        expandedRowRender={(record: TestPlan) => <CasesSubPanel plan={record} readOnly={readOnly} />}
      />

      <Modal
        title={
          editing
            ? t('common.superAssistant.editTestPlan', { defaultValue: '编辑测试计划' })
            : t('common.superAssistant.addTestPlan', { defaultValue: '新增计划' })
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
      >
        <Form form={form} layout='vertical'>
          <Form.Item
            field='title'
            label={t('common.superAssistant.testPlanTitle', { defaultValue: '计划标题' })}
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
                {PLAN_STATUSES.map((s) => (
                  <Select.Option key={s} value={s}>
                    {PLAN_STATUS_LABELS[s]}
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

export default TestPlansSection;
