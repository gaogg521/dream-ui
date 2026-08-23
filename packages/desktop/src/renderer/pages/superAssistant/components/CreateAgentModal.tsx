/**
 * Create digital employee modal — expert + backend + model + instructions.
 *
 * Previously this offered a hardcoded three-entry "Agent 类型" dropdown whose
 * labels were raw internal identifiers ('DreamEngine' rather than the product name)
 * and which had no model field at all. That combination made every dream
 * employee fail its first run with `Provider '' not found`, and gave no way to
 * pick one of the experts in the marketplace. Selection now runs through
 * `useEmployeeAgentBinding`, shared with ManageAgentModal.
 */

import React, { useEffect, useState } from 'react';
import { Form, Input, Message, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { CreatePersonalAgentInput } from '@/common/types/employee/employeeTypes';
import { useEmployeeAgentBinding } from '../hooks/useEmployeeAgentBinding';
import EmployeeBindingFields from './EmployeeBindingFields';

type CreateAgentModalProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
};

const CreateAgentModal: React.FC<CreateAgentModalProps> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const binding = useEmployeeAgentBinding();
  const { reset } = binding;

  useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
      setInstructions('');
      setSubmitting(false);
      reset();
    }
  }, [visible, reset]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Message.warning(t('common.superAssistant.nameRequired', { defaultValue: '请输入员工名称' }));
      return;
    }
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
      const payload: CreatePersonalAgentInput = {
        name: trimmedName,
        description: description.trim() || undefined,
        ...bound,
        automationConfig: instructions.trim() ? { instructions: instructions.trim() } : {},
      };
      await ipcBridge.personalAgent.create.invoke(payload);
      Message.success(t('common.superAssistant.createSuccess', { defaultValue: '创建成功' }));
      onCreated();
      onClose();
    } catch (error) {
      Message.error(t('common.superAssistant.createFailed', { defaultValue: '创建失败' }) + ': ' + String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={t('common.superAssistant.createAgentTitle', { defaultValue: '创建数字员工' })}
      visible={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      maskClosable={false}
    >
      <Form layout='vertical'>
        <Form.Item label={t('common.superAssistant.fieldName', { defaultValue: '名称' })}>
          <Input
            value={name}
            onChange={setName}
            placeholder={t('common.superAssistant.fieldNamePlaceholder', {
              defaultValue: '如：调研员',
            })}
          />
        </Form.Item>
        <EmployeeBindingFields binding={binding} />
        <Form.Item label={t('common.superAssistant.fieldDescription', { defaultValue: '描述' })}>
          <Input.TextArea
            value={description}
            onChange={setDescription}
            rows={2}
            placeholder={t('common.superAssistant.fieldDescriptionPlaceholder', {
              defaultValue: '职责描述（可选）',
            })}
          />
        </Form.Item>
        <Form.Item label={t('common.superAssistant.fieldInstructions', { defaultValue: '运行指令' })}>
          <Input.TextArea
            value={instructions}
            onChange={setInstructions}
            rows={4}
            placeholder={t('common.superAssistant.fieldInstructionsPlaceholder', {
              defaultValue: '每次运行时注入的 system prompt（可选）',
            })}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateAgentModal;
