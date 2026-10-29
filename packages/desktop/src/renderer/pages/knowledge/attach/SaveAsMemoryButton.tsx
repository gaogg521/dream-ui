/** Copyright 2026 One Work */
import React, { useState } from 'react';
import { Alert, Button, Input, Message, Modal } from '@arco-design/web-react';
import { Brain } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isNativeDialogAvailable, memory as memoryIpc } from '@/common/adapter/ipcBridge';
import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';

export default function SaveAsMemoryButton({
  document,
}: {
  document: Pick<RagDocumentEntry, 'id' | 'title'>;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  if (!isNativeDialogAvailable()) return null;
  const prepare = async (): Promise<void> => {
    setLoading(true);
    try {
      const text = await ipcBridge.oneDevops.getRagContent.invoke({ id: document.id });
      if (!text.trim()) {
        Message.warning(t('memory.space.toMemoryEmpty'));
        return;
      }
      if (new TextEncoder().encode(text).length > 1024 * 1024) {
        Message.warning(t('memory.space.toMemoryTooLarge'));
        return;
      }
      setContent(text);
      setDescription(`${document.title} ${text.replace(/\s+/g, ' ')}`.slice(0, 120));
      setOpen(true);
    } catch {
      Message.error(t('memory.space.toMemoryFailed'));
    } finally {
      setLoading(false);
    }
  };
  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await memoryIpc.engineImportReference.invoke({ title: document.title, description, content });
      window.dispatchEvent(new Event('one-memory-changed'));
      Message.success(t('memory.space.toMemoryDone'));
      setOpen(false);
    } catch {
      Message.error(t('memory.space.toMemoryFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Button size='small' status='success' icon={<Brain />} loading={loading} onClick={() => void prepare()}>
        {t('memory.space.toMemory')}
      </Button>
      <Modal
        visible={open}
        title={t('memory.space.toMemoryTitle')}
        onOk={save}
        onCancel={() => {
          if (!saving) setOpen(false);
        }}
        okText={t('memory.space.toMemory')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        maskClosable={!saving}
        cancelButtonProps={{ disabled: saving }}
      >
        <div className='flex flex-col gap-12px'>
          <strong>{document.title}</strong>
          <Alert type='info' content={t('memory.space.toMemoryBody')} />
          <label>
            {t('memory.space.toMemoryDescription')}
            <Input.TextArea value={description} onChange={setDescription} maxLength={120} showWordLimit rows={3} />
          </label>
        </div>
      </Modal>
    </>
  );
}
