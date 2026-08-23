/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ImportAssistantsResult } from '@/common/types/agent/assistantTypes';
import DreamModal from '@/renderer/components/base/DreamModal';
import { Button, Checkbox, Spin, Tag, Tooltip } from '@arco-design/web-react';
import { Check } from '@icon-park/react';
import { iconColors } from '@/renderer/styles/colors';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isPersonaParseFailure,
  parsePersonaMarkdownFile,
  type ParsedPersonaFile,
  type PersonaParseFailure,
} from './personaImportUtils';

type Phase = 'pick' | 'result';

interface PersonaImportModalProps {
  visible: boolean;
  onCancel: () => void;
  /** Fired after a successful submit, so the caller can refresh its list. */
  onImported: () => void;
}

const PersonaImportModal: React.FC<PersonaImportModalProps> = ({ visible, onCancel, onImported }) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('pick');
  const [picking, setPicking] = useState(false);
  const [parsed, setParsed] = useState<ParsedPersonaFile[]>([]);
  const [failures, setFailures] = useState<PersonaParseFailure[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportAssistantsResult | null>(null);

  const resetState = () => {
    setPhase('pick');
    setPicking(false);
    setParsed([]);
    setFailures([]);
    setSelectedIds(new Set());
    setSubmitting(false);
    setResult(null);
  };

  const handleCancel = () => {
    resetState();
    onCancel();
  };

  const handleDone = () => {
    resetState();
    onImported();
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = parsed.length > 0 && parsed.every((item) => selectedIds.has(item.id));
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(parsed.map((item) => item.id)));
  };

  const handlePickFiles = async () => {
    setPicking(true);
    try {
      const filePaths = await ipcBridge.dialog.showOpen.invoke({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!filePaths || filePaths.length === 0) {
        return;
      }

      const files = await ipcBridge.application.readTextFiles.invoke({ filePaths });
      const nextParsed: ParsedPersonaFile[] = [];
      const nextFailures: PersonaParseFailure[] = [];

      for (const file of files) {
        if ('error' in file) {
          nextFailures.push({ filePath: file.filePath, fileName: file.fileName, error: file.error });
          continue;
        }
        const outcome = parsePersonaMarkdownFile(file.filePath, file.fileName, file.content);
        if (isPersonaParseFailure(outcome)) {
          nextFailures.push(outcome);
        } else {
          nextParsed.push(outcome);
        }
      }

      setParsed((prev) => [...prev, ...nextParsed]);
      setFailures((prev) => [...prev, ...nextFailures]);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        nextParsed.forEach((item) => next.add(item.id));
        return next;
      });
    } catch (error) {
      console.error('Failed to pick/read persona files:', error);
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async () => {
    const selected = parsed.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;

    setSubmitting(true);
    try {
      const submitResult = await ipcBridge.assistants.importPersonas.invoke({
        assistants: selected.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          rule_content: item.ruleContent,
        })),
      });
      setResult(submitResult);
      setPhase('result');
    } catch (error) {
      console.error('Failed to import personas:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  const renderPickPhase = () => (
    <div>
      <div className='mb-16px flex items-center justify-between gap-10px'>
        <Button type='outline' loading={picking} onClick={() => void handlePickFiles()}>
          {t('settings.personaImportSelectFiles')}
        </Button>
        {parsed.length > 0 && (
          <Button type='text' size='mini' onClick={toggleSelectAll}>
            {allSelected ? t('settings.personaImportDeselectAll') : t('settings.personaImportSelectAll')}
          </Button>
        )}
      </div>

      {parsed.length === 0 && failures.length === 0 ? (
        <div className='py-40px text-center text-t-secondary text-13px'>{t('settings.personaImportEmptyState')}</div>
      ) : (
        <div className='bg-base rounded-lg max-h-[360px] overflow-y-auto'>
          {parsed.map((item, index) => (
            <div
              key={item.filePath}
              className='p-3'
              style={
                index < parsed.length - 1 || failures.length > 0 ? { borderBottom: '1px solid var(--bg-3)' } : undefined
              }
            >
              <div className='flex items-center gap-2'>
                <Checkbox checked={selectedIds.has(item.id)} onChange={() => toggleSelected(item.id)} />
                <div className='min-w-0 flex-1'>
                  <div className='font-medium text-t-primary truncate'>{item.name}</div>
                  {item.description && <div className='text-sm text-t-secondary mt-1 truncate'>{item.description}</div>}
                </div>
                {item.descriptionFallback && (
                  <Tooltip content={t('settings.personaImportDescriptionFallbackHint')}>
                    <Tag color='gray'>{t('settings.personaImportDescriptionFallbackTag')}</Tag>
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
          {failures.map((item, index) => (
            <div
              key={item.filePath}
              className='p-3'
              style={index < failures.length - 1 ? { borderBottom: '1px solid var(--bg-3)' } : undefined}
            >
              <div className='flex items-center justify-between gap-3'>
                <div className='font-medium text-t-primary truncate'>{item.fileName}</div>
                <Tooltip content={item.error}>
                  <Tag color='red'>{t('settings.personaImportInvalidFile')}</Tag>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderResultPhase = () => {
    if (!result) return null;
    return (
      <div>
        <div className='mb-12px flex items-center gap-2'>
          <Check theme='filled' size={20} fill={iconColors.success} />
          <span className='text-t-primary'>
            {t('settings.personaImportResultSummary', {
              imported: result.imported,
              skipped: result.skipped,
              failed: result.failed,
            })}
          </span>
        </div>
        {result.errors.length > 0 && (
          <div className='bg-base rounded-lg max-h-[240px] overflow-y-auto'>
            {result.errors.map((err, index) => (
              <div
                key={`${err.id}-${index}`}
                className='p-3'
                style={index < result.errors.length - 1 ? { borderBottom: '1px solid var(--bg-3)' } : undefined}
              >
                <div className='flex items-center justify-between gap-3'>
                  <div className='font-medium text-t-primary truncate'>{err.id}</div>
                  <Tag color='red'>{t('settings.personaImportInvalidFile')}</Tag>
                </div>
                <div className='text-sm text-t-secondary mt-1'>{err.error}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderFooter = () => {
    if (phase === 'result') {
      return (
        <div className='flex justify-end gap-10px'>
          <Button type='primary' onClick={handleDone} className='min-w-120px' style={{ borderRadius: 8 }}>
            {t('common.confirm')}
          </Button>
        </div>
      );
    }
    return (
      <div className='flex justify-end gap-10px'>
        <Button onClick={handleCancel} className='min-w-100px' style={{ borderRadius: 8 }}>
          {t('common.cancel')}
        </Button>
        <Button
          type='primary'
          loading={submitting}
          disabled={selectedIds.size === 0 || submitting}
          onClick={() => void handleSubmit()}
          className='min-w-140px'
          style={{ borderRadius: 8 }}
        >
          {t('settings.personaImportSubmit', { count: selectedIds.size })}
        </Button>
      </div>
    );
  };

  return (
    <DreamModal
      variant='standard'
      header={{ title: t('settings.personaImportTitle'), showClose: true }}
      visible={visible}
      onCancel={handleCancel}
      footer={{ render: renderFooter }}
      style={{ width: 680 }}
    >
      <div className='flex min-h-0 flex-col'>
        <div className='mb-16px text-t-secondary text-sm'>{t('settings.personaImportDescription')}</div>
        {picking && parsed.length === 0 && failures.length === 0 ? (
          <div className='py-40px flex items-center justify-center gap-3'>
            <Spin size={20} />
            <span className='text-t-secondary text-sm'>{t('settings.personaImportParsing')}</span>
          </div>
        ) : phase === 'pick' ? (
          renderPickPhase()
        ) : (
          renderResultPhase()
        )}
      </div>
    </DreamModal>
  );
};

export default PersonaImportModal;
