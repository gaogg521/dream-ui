/**
 * Digital employee detail modal — what the employee can do (description,
 * bound skills and tools, example tasks) and its run history.
 *
 * Bound resources are named by registry id in the employee definition; the
 * names come from the registries this member can read (the company server in
 * client mode). When a registry cannot be read the count still shows.
 */

import React, { useEffect, useState } from 'react';
import { Button, Descriptions, Empty, Modal, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
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
import { resolveEmployeeAvatar } from '../utils/employeeAvatar';
import { resolveEmployeeStarterPrompts } from '../utils/startEmployeeChat';

type DetailModalProps = {
  visible: boolean;
  agent: PersonalAgent | null;
  onClose: () => void;
  onStartChat?: (agentId: string, firstMessage?: string) => void;
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'processing',
  success: 'success',
  failed: 'red',
};

const idsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Registry names for the bound ids; ids the registry does not list are left out. */
function useBoundResourceNames(agent: PersonalAgent | null, visible: boolean) {
  const [names, setNames] = useState<{ skills: string[]; tools: string[] } | null>(null);
  const skillIds = idsOf(agent?.automationConfig?.boundSkillIds);
  const toolIds = idsOf(agent?.automationConfig?.boundMcpIds);
  const key = `${skillIds.join(',')}|${toolIds.join(',')}`;

  useEffect(() => {
    setNames(null);
    if (!visible || (skillIds.length === 0 && toolIds.length === 0)) return;
    let cancelled = false;
    type Named = { id: string; name: string };
    const pick = (rows: Named[] | undefined, ids: string[]): string[] =>
      ids.map((id) => rows?.find((row) => row.id === id)?.name).filter((name): name is string => Boolean(name));
    const load = (wanted: string[], fetch: () => Promise<Named[]>): Promise<Named[] | undefined> =>
      wanted.length ? fetch().catch((): undefined => undefined) : Promise.resolve([]);
    void Promise.all([
      load(skillIds, () => ipcBridge.oneDevops.listSkills.invoke()),
      load(toolIds, () => ipcBridge.oneDevops.listMcpRegistry.invoke()),
    ]).then(([skills, tools]) => {
      if (!cancelled) setNames({ skills: pick(skills, skillIds), tools: pick(tools, toolIds) });
    });
    return () => {
      cancelled = true;
    };
    // `key` captures both id lists; the arrays themselves are rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);

  return { skillIds, toolIds, names };
}

function formatTime(ms?: number | null): string {
  if (!ms) {
    return '-';
  }
  return new Date(ms).toLocaleString();
}

const DigitalEmployeeDetailModal: React.FC<DetailModalProps> = ({ visible, agent, onClose, onStartChat }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const bound = useBoundResourceNames(agent, visible);
  const starterPrompts = agent ? resolveEmployeeStarterPrompts(agent) : [];
  const isCompanyEmployee = agent?.origin === 'team';
  const renderBound = (ids: string[], names: string[] | undefined) => {
    if (ids.length === 0) return '-';
    if (!names || names.length === 0) return t('common.superAssistant.boundCount', { count: ids.length });
    return (
      <span className='flex flex-wrap gap-4px'>
        {names.map((name) => (
          <Tag key={name} size='small'>
            {name}
          </Tag>
        ))}
      </span>
    );
  };
  const localeKey = resolveLocaleKey(i18n?.language ?? 'en-US');
  const managedAgentRuntimeCatalog = useManagedAgentRuntimeCatalog();
  const { presetAssistants } = useConversationAssistants();
  const expertName = agent ? resolveEmployeeExpertName(agent, presetAssistants, localeKey) : undefined;
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
          <div className='flex items-center gap-12px rd-12px bg-fill-1 p-12px'>
            <img
              src={resolveEmployeeAvatar(agent)}
              alt=''
              className='h-64px w-64px rd-14px border border-2 object-cover'
            />
            <div>
              <div className='text-16px font-600 text-t-primary'>{agent.name}</div>
              <div className='mt-4px text-12px text-t-tertiary'>
                {agent.description ?? t('common.superAssistant.employeeIdentityHint', { defaultValue: '企业数字员工' })}
              </div>
            </div>
          </div>
          <Descriptions
            column={2}
            data={[
              { label: t('common.superAssistant.fieldName', { defaultValue: '名称' }), value: agent.name },
              ...(expertName
                ? [{ label: t('common.superAssistant.fieldExpert', { defaultValue: '专家' }), value: expertName }]
                : []),
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
                label: t('common.superAssistant.fieldBoundSkills'),
                value: renderBound(bound.skillIds, bound.names?.skills),
              },
              {
                label: t('common.superAssistant.fieldBoundTools'),
                value: renderBound(bound.toolIds, bound.names?.tools),
              },
              // A company employee is never scheduled from here, so the schedule
              // rows would only ever read "no" / "-".
              ...(isCompanyEmployee
                ? []
                : [
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
                  ]),
              {
                label: t('common.superAssistant.fieldCreatedAt', { defaultValue: '创建时间' }),
                value: formatTime(agent.createdAt),
              },
            ]}
          />
          <div className='flex flex-col items-start gap-6px'>
            <div className='text-13px font-500'>{t('common.superAssistant.starterPromptsTitle')}</div>
            {starterPrompts.map((prompt) => (
              <Button
                key={prompt}
                type='text'
                size='small'
                className='!h-auto !px-0 !text-start !whitespace-normal'
                onClick={() => onStartChat?.(agent.id, prompt)}
              >
                {prompt}
              </Button>
            ))}
            <Button type='primary' size='small' onClick={() => onStartChat?.(agent.id)}>
              {t('common.superAssistant.startChat')}
            </Button>
          </div>
          <div>
            <div className='mb-8px text-13px font-500'>
              {t('common.superAssistant.runHistoryTitle', { defaultValue: '运行历史' })}
            </div>
            {loading ? null : runs.length === 0 ? (
              <Empty description={t('common.superAssistant.noRuns', { defaultValue: '暂无运行记录' })} />
            ) : (
              <div className='flex flex-col gap-8px'>
                {runs.map((run) => (
                  <div key={run.id} className='rounded-6px border border-2 p-8px'>
                    <div className='flex items-center justify-between'>
                      {run.triggerSource === 'chat' ? (
                        <Tag size='small' color='arcoblue'>
                          {t('common.superAssistant.chatSession')}
                        </Tag>
                      ) : (
                        <Tag size='small' color={RUN_STATUS_COLOR[run.status] ?? 'default'}>
                          {t(`common.superAssistant.runStatus.${run.status}`, { defaultValue: run.status })}
                        </Tag>
                      )}
                      <span className='flex items-center gap-8px text-12px text-t-quaternary'>
                        {t('common.superAssistant.startedAt', { defaultValue: '开始' })}: {formatTime(run.startedAt)}
                        <Button
                          type='text'
                          size='mini'
                          onClick={() => {
                            onClose();
                            void navigate(`/conversation/${run.conversationId}`);
                          }}
                        >
                          {t('common.superAssistant.openConversation')}
                        </Button>
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
