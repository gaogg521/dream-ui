/**
 * Skill registry management — list / create / edit / delete / enable-toggle
 * on top of the one-devops skills endpoints.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Message, Modal, Popconfirm, Switch, Table } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { ResourceScope, ResourceVisibility, SkillRegistryEntry } from '@/common/types/devops/devopsTypes';
import { aclInitialValues, aclPayload, ResourceAclCell, ResourceAclFields, useAllTenants } from './ResourceAcl';

type SkillsSectionProps = { readOnly?: boolean };

const SkillsSection: React.FC<SkillsSectionProps> = ({ readOnly = false }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SkillRegistryEntry[]>([]);
  const [editing, setEditing] = useState<SkillRegistryEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const { tenants } = useAllTenants();

  const refresh = useCallback(async () => {
    try {
      const next = await ipcBridge.oneDevops.listSkills.invoke();
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

  const openEdit = (row: SkillRegistryEntry) => {
    setEditing(row);
    setModalVisible(true);
  };

  // Keying the Form on the editing target + deriving `initialValues`
  // declaratively (rather than imperative `resetFields`/`setFieldsValue`
  // calls racing the Modal's one-render-later mount) avoids a confirmed bug:
  // `autoActive` (a Switch with no entry in the old static `initialValues`)
  // silently kept its default instead of the row's real value when editing.
  const formInitialValues = editing
    ? {
        name: editing.name,
        description: editing.description,
        content: editing.content,
        enabled: editing.enabled,
        autoActive: editing.autoActive,
        ...aclInitialValues(editing),
      }
    : { enabled: true, autoActive: false, ...aclInitialValues(null) };

  const handleSave = async () => {
    const values = (await form.validate().catch((): null => null)) as {
      name: string;
      description?: string;
      content?: string;
      enabled?: boolean;
      autoActive?: boolean;
      scope?: ResourceScope;
      teamId?: string | null;
      visibility?: ResourceVisibility;
    } | null;
    if (!values) {
      return;
    }
    setSaving(true);
    try {
      await ipcBridge.oneDevops.upsertSkill.invoke({
        id: editing?.id,
        name: values.name,
        description: values.description ?? '',
        content: values.content ?? '',
        enabled: values.enabled ?? true,
        autoActive: values.autoActive ?? false,
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
      await ipcBridge.oneDevops.deleteSkill.invoke({ id });
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

  const handleToggle = async (row: SkillRegistryEntry, enabled: boolean) => {
    try {
      await ipcBridge.oneDevops.upsertSkill.invoke({
        id: row.id,
        name: row.name,
        description: row.description,
        content: row.content,
        enabled,
        autoActive: row.autoActive,
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
      render: (_: unknown, record: SkillRegistryEntry) => record.name,
    },
    {
      title: t('common.superAssistant.registries.colDescription', { defaultValue: '描述' }),
      render: (_: unknown, record: SkillRegistryEntry) => (
        <span className='text-12px text-t-secondary'>{record.description}</span>
      ),
    },
    {
      title: t('common.superAssistant.registries.colEnabled', { defaultValue: '启用' }),
      render: (_: unknown, record: SkillRegistryEntry) => (
        <Switch
          size='small'
          checked={record.enabled}
          disabled={readOnly}
          onChange={(checked) => void handleToggle(record, checked)}
        />
      ),
    },
    {
      title: t('common.superAssistant.registries.colAutoActive', { defaultValue: '成员自动启用' }),
      render: (_: unknown, record: SkillRegistryEntry) =>
        record.autoActive ? (
          <span className='text-12px text-green-6'>
            {t('common.superAssistant.registries.autoActiveOn', { defaultValue: '必选' })}
          </span>
        ) : (
          <span className='text-12px text-t-tertiary'>
            {t('common.superAssistant.registries.autoActiveOff', { defaultValue: '可选' })}
          </span>
        ),
    },
    {
      title: t('common.superAssistant.registries.colVisibility', { defaultValue: '可见范围' }),
      render: (_: unknown, record: SkillRegistryEntry) => (
        <ResourceAclCell scope={record.scope} teamId={record.teamId} visibility={record.visibility} tenants={tenants} />
      ),
    },
    {
      title: t('common.superAssistant.registries.colUpdatedAt', { defaultValue: '更新时间' }),
      render: (_: unknown, record: SkillRegistryEntry) => new Date(record.updatedAt).toLocaleString(),
    },
    ...(readOnly
      ? []
      : [
          {
            title: t('common.superAssistant.registries.colActions', { defaultValue: '操作' }),
            render: (_: unknown, record: SkillRegistryEntry) => (
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
      title={t('common.superAssistant.registries.skillsTitle', { defaultValue: 'Skills 注册表' })}
      extra={
        !readOnly && (
          <Button type='primary' size='small' onClick={openCreate}>
            {t('common.superAssistant.registries.addSkill', { defaultValue: '新增 Skill' })}
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
            ? t('common.superAssistant.registries.editSkill', { defaultValue: '编辑 Skill' })
            : t('common.superAssistant.registries.addSkill', { defaultValue: '新增 Skill' })
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
          <Form.Item
            field='description'
            label={t('common.superAssistant.registries.colDescription', { defaultValue: '描述' })}
          >
            <Input />
          </Form.Item>
          <Form.Item
            field='content'
            label={t('common.superAssistant.registries.skillContent', { defaultValue: '内容（SKILL.md）' })}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            field='enabled'
            label={t('common.superAssistant.registries.colEnabled', { defaultValue: '启用' })}
            triggerPropName='checked'
          >
            <Switch />
          </Form.Item>
          <Form.Item
            field='autoActive'
            label={t('common.superAssistant.registries.colAutoActive', { defaultValue: '成员自动启用（必选技能）' })}
            extra={t('common.superAssistant.registries.autoActiveHint', {
              defaultValue: '开启后，成员机的 AI 助手会自动加载该技能，无需成员手动勾选。',
            })}
            triggerPropName='checked'
          >
            <Switch />
          </Form.Item>
          <ResourceAclFields tenants={tenants} />
        </Form>
      </Modal>
    </Card>
  );
};

export default SkillsSection;
