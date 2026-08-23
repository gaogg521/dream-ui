/**
 * Manage digital employee modal — edit name / description / instructions, plus
 * the expert / backend / model binding.
 *
 * The binding is editable here (rather than being fixed at creation) so a
 * mis-picked model does not force the user to delete and rebuild the employee.
 */

import React, { useEffect, useState } from 'react';
import { Form, Input, Message, Modal, Switch } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';
import { useEmployeeAgentBinding } from '../hooks/useEmployeeAgentBinding';
import EmployeeBindingFields from './EmployeeBindingFields';

type ManageAgentModalProps = {
  visible: boolean;
  agent: PersonalAgent | null;
  onClose: () => void;
  onSaved: () => void;
};

const ManageAgentModal: React.FC<ManageAgentModalProps> = ({ visible, agent, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [shared, setShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const binding = useEmployeeAgentBinding();
  const { reset } = binding;

  // Sharing only makes sense inside an enterprise tenant; the personal
  // 'default' tenant has a single member with nobody to share with.
  const isEnterprise = Boolean(agent && agent.tenantId && agent.tenantId !== 'default');

  useEffect(() => {
    if (!visible || !agent) {
      return;
    }
    setSubmitting(false);
    setName(agent.name);
    setDescription(agent.description ?? '');
    setInstructions(agent.automationConfig?.instructions ?? '');
    setShared(agent.visibility === 'shared');
    reset({
      // Employees created before migration 004 have no persona; fall back to
      // the legacy column the backend also treats as a persona source.
      assistantId: agent.assistantId ?? agent.customAgentId,
      agentIdOverride: agent.agentIdOverride,
      modelId: agent.modelId,
      model: agent.model,
    });
  }, [visible, agent, reset]);

  const handleSubmit = async () => {
    if (!agent) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      Message.warning(t('common.superAssistant.nameRequired', { defaultValue: '请输入员工名称' }));
      return;
    }
    // The binding must still be valid after editing. It resolves to `undefined`
    // only when a required piece is missing — a backend, or a model for dream.
    const bound = binding.buildBinding();
    if (!bound) {
      Message.warning(
        binding.resolvedBackend
          ? t('common.superAssistant.modelRequired', { defaultValue: '请为该员工选择一个模型' })
          : t('common.superAssistant.backendRequired', { defaultValue: '请选择运行后端' })
      );
      return;
    }

    setSubmitting(true);
    try {
      await ipcBridge.personalAgent.update.invoke({
        agentId: agent.id,
        updates: {
          name: trimmedName,
          description: description.trim() || undefined,
          ...bound,
          automationConfig: {
            ...agent.automationConfig,
            instructions: instructions.trim() || undefined,
          },
        },
      });
      // Visibility is a separate endpoint; only apply it when it changed and
      // sharing is available (enterprise tenant).
      if (isEnterprise && (agent.visibility === 'shared') !== shared) {
        await ipcBridge.personalAgent.setVisibility.invoke({
          agentId: agent.id,
          visibility: shared ? 'shared' : 'private',
        });
      }
      Message.success(t('common.superAssistant.saveSuccess', { defaultValue: '保存成功' }));
      onSaved();
      onClose();
    } catch (error) {
      Message.error(t('common.superAssistant.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('common.superAssistant.manageTitle', { defaultValue: '管理员工' })}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      maskClosable={false}
    >
      <Form layout='vertical'>
        <Form.Item label={t('common.superAssistant.fieldName', { defaultValue: '名称' })}>
          <Input value={name} onChange={setName} />
        </Form.Item>
        <EmployeeBindingFields binding={binding} />
        <Form.Item label={t('common.superAssistant.fieldDescription', { defaultValue: '描述' })}>
          <Input.TextArea value={description} onChange={setDescription} rows={2} />
        </Form.Item>
        <Form.Item label={t('common.superAssistant.fieldInstructions', { defaultValue: '运行指令' })}>
          <Input.TextArea value={instructions} onChange={setInstructions} rows={4} />
        </Form.Item>
        {isEnterprise ? (
          <Form.Item
            label={t('common.superAssistant.fieldShared', { defaultValue: '共享给团队' })}
            extra={t('common.superAssistant.sharedHint', {
              defaultValue: '开启后，同团队成员可在协作看板把需求派给这个数字员工',
            })}
          >
            <Switch checked={shared} onChange={setShared} />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default ManageAgentModal;
