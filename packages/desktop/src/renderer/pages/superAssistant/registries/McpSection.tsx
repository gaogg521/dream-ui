/**
 * MCP connector registry management — list / create / edit / delete /
 * enable-toggle on top of the one-devops mcp-registry endpoints.
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
  Switch,
  Table,
  Tag,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { McpRegistryEntry, ResourceScope, ResourceVisibility } from '@/common/types/devops/devopsTypes';
import { aclInitialValues, aclPayload, ResourceAclCell, ResourceAclFields, useAllTenants } from './ResourceAcl';

const MCP_TYPES = ['stdio', 'sse'] as const;

type McpSectionProps = { readOnly?: boolean };

const McpSection: React.FC<McpSectionProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<McpRegistryEntry[]>([]);
  const [editing, setEditing] = useState<McpRegistryEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const { tenants } = useAllTenants();

  const refresh = useCallback(async () => {
    try {
      const next = await ipcBridge.oneDevops.listMcpRegistry.invoke();
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
    setModalVisible(true);
  };

  const openEdit = (row: McpRegistryEntry) => {
    setEditing(row);
    setModalVisible(true);
  };

  // Modal content (and thus the Select/Switch/TextArea fields) only mounts
  // once `modalVisible` flips true, one render after `openEdit` calls
  // `setEditing`. Calling `form.setFieldsValue(...)` synchronously in
  // `openEdit` (the previous approach) raced that mount: Select/Switch/
  // TextArea fields silently kept the Form's static `initialValues` (type=
  // stdio, hasKeys=false, empty secrets) instead of the row's real values —
  // the plain `<Input>` fields (name/endpoint) happened to still work because
  // they have no conflicting `initialValues` entry. Keying the Form on the
  // editing target and deriving `initialValues` declaratively sidesteps the
  // race entirely: every open is a fresh mount with the correct values.
  const formInitialValues = editing
    ? {
        name: editing.name,
        type: editing.type,
        endpoint: editing.endpoint,
        enabled: editing.enabled,
        hasKeys: editing.hasKeys,
        secretsJson: editing.secretsJson ?? '',
        ...aclInitialValues(editing),
      }
    : { type: 'stdio' as const, enabled: true, hasKeys: false, secretsJson: '', ...aclInitialValues(null) };

  const handleSave = async () => {
    const values = (await form.validate().catch((): null => null)) as {
      name: string;
      type: 'stdio' | 'sse';
      endpoint?: string;
      enabled?: boolean;
      hasKeys?: boolean;
      secretsJson?: string;
      scope?: ResourceScope;
      teamId?: string | null;
      visibility?: ResourceVisibility;
    } | null;
    if (!values) {
      return;
    }
    setSaving(true);
    try {
      await ipcBridge.oneDevops.upsertMcpRegistry.invoke({
        id: editing?.id,
        name: values.name,
        type: values.type,
        endpoint: values.endpoint ?? '',
        enabled: values.enabled ?? true,
        hasKeys: values.hasKeys ?? false,
        secretsJson: values.secretsJson?.trim() ? values.secretsJson.trim() : undefined,
        ...aclPayload(values),
      });
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
      await ipcBridge.oneDevops.deleteMcpRegistry.invoke({ id });
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

  const handleToggle = async (row: McpRegistryEntry, enabled: boolean) => {
    try {
      await ipcBridge.oneDevops.upsertMcpRegistry.invoke({
        id: row.id,
        name: row.name,
        type: row.type,
        endpoint: row.endpoint,
        enabled,
        hasKeys: row.hasKeys,
        secretsJson: row.secretsJson ?? undefined,
        // Preserve the row's ACL — a bare toggle must not reset it to org/all.
        ...aclPayload(row),
      });
      await refresh();
    } catch (error) {
      Message.error(
        t('common.superAssistant.registries.saveFailed', { defaultValue: '保存失败' }) +
          ': ' +
          friendlyEnterpriseError(error, t)
      );
    }
  };

  const columns = [
    {
      title: t('common.superAssistant.registries.colName', { defaultValue: '名称' }),
      render: (_: unknown, record: McpRegistryEntry) => record.name,
    },
    {
      title: t('common.superAssistant.registries.colType', { defaultValue: '类型' }),
      render: (_: unknown, record: McpRegistryEntry) => (
        <Tag size='small' color={record.type === 'sse' ? 'purple' : 'arcoblue'}>
          {record.type}
        </Tag>
      ),
    },
    {
      title: t('common.superAssistant.registries.colEndpoint', { defaultValue: '端点/命令' }),
      render: (_: unknown, record: McpRegistryEntry) => (
        <span className='text-12px text-t-secondary'>{record.endpoint}</span>
      ),
    },
    {
      title: t('common.superAssistant.registries.colEnabled', { defaultValue: '启用' }),
      render: (_: unknown, record: McpRegistryEntry) => (
        <Switch
          size='small'
          checked={record.enabled}
          disabled={readOnly}
          onChange={(checked) => void handleToggle(record, checked)}
        />
      ),
    },
    {
      title: t('common.superAssistant.registries.colVisibility', { defaultValue: '可见范围' }),
      render: (_: unknown, record: McpRegistryEntry) => (
        <ResourceAclCell scope={record.scope} teamId={record.teamId} visibility={record.visibility} tenants={tenants} />
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, record: McpRegistryEntry) => (
              <div className='flex gap-6px'>
                <Button size='small' onClick={() => openEdit(record)}>
                  {t('common.edit', { defaultValue: '编辑' })}
                </Button>
                <Popconfirm
                  title={t('common.superAssistant.registries.deleteConfirm', { defaultValue: '确认删除？' })}
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
      title={t('common.superAssistant.registries.mcpTitle', { defaultValue: 'MCP 注册表' })}
      extra={
        !readOnly && (
          <Button type='primary' size='small' onClick={openCreate}>
            {t('common.superAssistant.registries.addMcp', { defaultValue: '新增 MCP' })}
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
            ? t('common.superAssistant.registries.editMcp', { defaultValue: '编辑 MCP' })
            : t('common.superAssistant.registries.addMcp', { defaultValue: '新增 MCP' })
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
      >
        <Form form={form} layout='vertical' initialValues={formInitialValues} key={editing?.id ?? 'create'}>
          <Form.Item
            field='name'
            label={t('common.superAssistant.registries.colName', { defaultValue: '名称' })}
            rules={[{ required: true, message: t('common.required', { defaultValue: '必填' }) }]}
          >
            <Input />
          </Form.Item>
          <Form.Item field='type' label={t('common.superAssistant.registries.colType', { defaultValue: '类型' })}>
            <Select>
              {MCP_TYPES.map((type) => (
                <Select.Option key={type} value={type}>
                  {type}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            field='endpoint'
            label={t('common.superAssistant.registries.colEndpoint', { defaultValue: '端点/命令' })}
          >
            <Input placeholder='https://... 或 npx ...' />
          </Form.Item>
          <Form.Item
            field='enabled'
            label={t('common.superAssistant.registries.colEnabled', { defaultValue: '启用' })}
            triggerPropName='checked'
          >
            <Switch />
          </Form.Item>
          <Form.Item
            field='hasKeys'
            label={t('common.superAssistant.registries.mcpHasKeys', { defaultValue: '需要密钥' })}
            triggerPropName='checked'
          >
            <Switch />
          </Form.Item>
          <Form.Item
            field='secretsJson'
            label={t('common.superAssistant.registries.mcpSecrets', {
              defaultValue: '凭据（JSON：stdio 为 env，sse 为 headers）',
            })}
            extra={t('common.superAssistant.registries.mcpSecretsHint', {
              defaultValue:
                '例如 {"Authorization":"Bearer xxx"}。⚠️ 会分发到每台成员机以支持离线使用，仅填团队可共享的凭据。',
            })}
          >
            <Input.TextArea rows={3} placeholder='{"KEY":"value"}' />
          </Form.Item>
          <ResourceAclFields tenants={tenants} />
        </Form>
      </Modal>
    </Card>
  );
};

export default McpSection;
