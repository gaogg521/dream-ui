/** Copyright 2026 One Work */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Message, Modal, Select, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isEnterpriseRemoteActive } from '@/common/adapter/enterpriseMode';
import type { RagLibraryEntry } from '@/common/types/devops/devopsTypes';
import { isOrgAdminRole, useOrgContext } from '../../enterprise/hooks/useOrgContext';
import { friendlyEnterpriseError } from '@/renderer/utils/enterprise/friendlyEnterpriseError';
import { importLocalArtifact } from './artifactImport';

export default function ImportArtifactModal({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [enterprise] = useState(isEnterpriseRemoteActive);
  const { context, loading: contextLoading, error } = useOrgContext();
  const [libraries, setLibraries] = useState<RagLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [destination, setDestination] = useState('personal');
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const canShare = enterprise && !contextLoading && !error && isOrgAdminRole(context?.role);
  useEffect(() => {
    let live = true;
    void ipcBridge.oneDevops.listRagLibraries
      .invoke()
      .then((rows) => {
        if (live) setLibraries(rows);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.current?.abort();
    };
  }, []);
  const options = [
    { value: 'personal', label: t('common.knowledgeLibrary.personal') },
    ...(canShare ? [{ value: 'org', label: t('common.knowledgeLibrary.team') }] : []),
    ...libraries
      .filter((library) => library.scope === 'personal' || canShare)
      .map((library) => ({
        value: `library:${library.id}`,
        label: `${library.scope === 'personal' ? t('common.knowledgeLibrary.personal') : t('common.knowledgeLibrary.team')} / ${library.name}`,
      })),
  ];
  const save = async (): Promise<void> => {
    if (controller.current) return;
    if (enterprise !== isEnterpriseRemoteActive()) {
      Message.error(t('common.artifactImport.modeChanged'));
      return;
    }
    const target = libraries.find((library) => `library:${library.id}` === destination);
    const personal = destination === 'personal' || target?.scope === 'personal';
    if (!personal && !canShare) return;
    const pending = new AbortController();
    controller.current = pending;
    setSaving(true);
    try {
      const result = await importLocalArtifact(path, { personal, libraryId: target?.id }, pending.signal);
      Message.success(t(result.sourceOnly ? 'common.artifactImport.sourceOnly' : 'common.artifactImport.done'));
      window.dispatchEvent(new Event('one-library-changed'));
      onClose();
    } catch (cause) {
      if ((cause as { name?: string }).name !== 'AbortError')
        Message.error(`${t('common.artifactImport.failed')}: ${friendlyEnterpriseError(cause, t)}`);
    } finally {
      controller.current = null;
      setSaving(false);
    }
  };
  return (
    <Modal
      visible
      title={t('common.artifactImport.title')}
      onCancel={() => {
        controller.current?.abort();
        if (!saving) onClose();
      }}
      onOk={save}
      confirmLoading={saving}
      okText={t('common.artifactImport.add')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: loading || loadFailed || (enterprise && contextLoading) }}
      maskClosable={!saving}
    >
      <div className='flex flex-col gap-12px'>
        <div className='break-all text-t-secondary'>{path}</div>
        <Alert
          type='info'
          content={t(enterprise ? 'common.artifactImport.enterprise' : 'common.artifactImport.local')}
        />
        {loadFailed ? (
          <Alert type='error' content={t('common.artifactImport.failed')} />
        ) : (
          <Spin loading={loading}>
            <Select
              aria-label={t('common.artifactImport.destination')}
              value={destination}
              options={options}
              onChange={setDestination}
              disabled={saving}
            />
          </Spin>
        )}
      </div>
    </Modal>
  );
}
