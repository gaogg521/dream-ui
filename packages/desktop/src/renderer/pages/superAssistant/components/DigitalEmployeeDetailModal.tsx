/**
 * Digital employee detail modal — show run history for one agent.
 */

import React, { useEffect, useState } from 'react';
import { Descriptions, Empty, Modal, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { resolveLocaleKey } from '@/common/utils';
import { useManagedAgentRuntimeCatalog } from '@renderer/hooks/agent/useManagedAgents';
import { useConversationAssistants } from '@renderer/pages/conversation/hooks/useConversationAssistants';
import type { DigitalEmployeeRunRecord, PersonalAgent } from '@/common/types/employee/employeeTypes';
import {
  resolveEmployeeBackendLabel,
  resolveEmployeeExpertName,
  resolveEmployeeRunErrorMessage,
} from '../utils/employeeDisplay';

type DetailModalProps = {
  visible: boolean;
  agent: PersonalAgent | null;
  onClose: () => void;
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'processing',
  success: 'success',
  failed: 'red',
};

function formatTime(ms?: number | null): string {
  if (!ms) {
    return '-';
  }
  return new Date(ms).toLocaleString();
}

const DigitalEmployeeDetailModal: React.FC<DetailModalProps> = ({ visible, agent, onClose }) => {
  const { t, i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n?.language ?? 'en-US');
  const managedAgentRuntimeCatalog = useManagedAgentRuntimeCatalog();
  const { presetAssistants } = useConversationAssistants();
  const [runs, setRuns] = useState<DigitalEmployeeRunRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !agent) {
      setRuns([]);
      return;
    }
    setLoading(true);
    ipcBridge.personalAgent.listRuns
      .invoke({ agentId: agent.id })
      .then((data) => setRuns(data ?? []))
      .catch((error) => {
        console.error('[DigitalEmployeeDetailModal] listRuns failed', error);
        setRuns([]);
      })
      .finally(() => setLoading(false));
  }, [visible, agent]);

  return (
    <Modal
      title={t('common.superAssistant.detailTitle', { defaultValue: '员工详情' })}
      visible={visible}
      onCancel={onClose}
      footer={null}
    >
      {agent ? (
        <div className='flex flex-col gap-16px'>
          <Descriptions
            column={2}
            data={[
              { label: t('common.superAssistant.fieldName', { defaultValue: '名称' }), value: agent.name },
              {
                label: t('common.superAssistant.fieldExpert', { defaultValue: '专家' }),
                value: resolveEmployeeExpertName(agent, presetAssistants, localeKey) ?? '-',
              },
              {
                label: t('common.superAssistant.fieldBackend', { defaultValue: '运行后端' }),
                value: resolveEmployeeBackendLabel(agent, managedAgentRuntimeCatalog, localeKey),
              },
              {
                label: t('common.superAssistant.fieldModel', { defaultValue: '模型' }),
                value: agent.modelId ?? agent.model?.model ?? '-',
              },
              {
                label: t('common.superAssistant.fieldDescription', { defaultValue: '描述' }),
                value: agent.description ?? '-',
              },
              {
                label: t('common.superAssistant.fieldScheduled', { defaultValue: '已设定时' }),
                value: agent.scheduleEnabled
                  ? t('common.yes', { defaultValue: '是' })
                  : t('common.no', { defaultValue: '否' }),
              },
              {
                label: t('common.superAssistant.fieldNextRun', { defaultValue: '下次运行' }),
                value: formatTime(agent.nextRunAt),
              },
              {
                label: t('common.superAssistant.fieldCreatedAt', { defaultValue: '创建时间' }),
                value: formatTime(agent.createdAt),
              },
            ]}
          />
          <div>
            <div className='mb-8px text-13px font-500'>
              {t('common.superAssistant.runHistoryTitle', { defaultValue: '运行历史' })}
            </div>
            {loading ? null : runs.length === 0 ? (
              <Empty description={t('common.superAssistant.noRuns', { defaultValue: '暂无运行记录' })} />
            ) : (
              <div className='flex flex-col gap-8px'>
                {runs.map((run) => (
                  <div key={run.id} className='rounded-6px border border-border-2 p-8px'>
                    <div className='flex items-center justify-between'>
                      <Tag size='small' color={RUN_STATUS_COLOR[run.status] ?? 'default'}>
                        {t(`common.superAssistant.runStatus.${run.status}`, { defaultValue: run.status })}
                      </Tag>
                      <span className='text-12px text-t-quaternary'>
                        {t('common.superAssistant.startedAt', { defaultValue: '开始' })}: {formatTime(run.startedAt)}
                      </span>
                    </div>
                    {run.summary ? (
                      <div className='mt-4px text-12px text-t-secondary line-clamp-3'>{run.summary}</div>
                    ) : null}
                    {run.error ? (
                      <div className='mt-4px text-12px text-red-500 line-clamp-3'>
                        {resolveEmployeeRunErrorMessage(run.error, t)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

export default DigitalEmployeeDetailModal;
