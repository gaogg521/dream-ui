/**
 * Agents tab — list personal digital employees with run/schedule actions.
 *
 * Simplified from the 1one reference: drops team-agent groups and issue
 * assignment, keeps only the personal-agent cards backed by the
 * one-employee crate.
 */

import React, { useMemo } from 'react';
import { Button, Card, Empty, Popconfirm, Tag } from '@arco-design/web-react';
import { Delete, Edit, FileText, PlayOne, Plus, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { resolveLocaleKey } from '@/common/utils';
import { useManagedAgentRuntimeCatalog } from '@renderer/hooks/agent/useManagedAgents';
import { useConversationAssistants } from '@renderer/pages/conversation/hooks/useConversationAssistants';
import type { DigitalEmployeeWithRuns } from '../hooks/useDigitalEmployees';
import { resolveEmployeeBackendLabel, resolveEmployeeExpertName } from '../utils/employeeDisplay';
import { useAgentTemplates, getTemplateName, getTemplateDescription } from '../templates/agentTemplates';

export type AgentCardRef = {
  agentId: string;
  agentName: string;
  agentType: string;
};

type AgentsTabProps = {
  agents: DigitalEmployeeWithRuns[];
  onCreateAgent?: () => void;
  onCreateFromTemplate?: (templateId: string) => Promise<void>;
  creatingFromTemplate?: boolean;
  onManageAgent?: (agent: AgentCardRef) => void;
  onRunAgentNow?: (agent: AgentCardRef) => void;
  onScheduleAgent?: (agent: AgentCardRef) => void;
  onViewDigitalEmployeeDetail?: (agent: AgentCardRef) => void;
  onDeleteAgent?: (agent: AgentCardRef) => Promise<void>;
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'processing',
  success: 'success',
  failed: 'red',
};

const AgentsTab: React.FC<AgentsTabProps> = ({
  agents,
  onCreateAgent,
  onCreateFromTemplate,
  creatingFromTemplate,
  onManageAgent,
  onRunAgentNow,
  onScheduleAgent,
  onViewDigitalEmployeeDetail,
  onDeleteAgent,
}) => {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const language = i18n.language;
  const localeKey = resolveLocaleKey(language ?? 'en-US');
  const templates = useAgentTemplates();
  const managedAgentRuntimeCatalog = useManagedAgentRuntimeCatalog();
  const { presetAssistants } = useConversationAssistants();

  const cards = useMemo(() => agents, [agents]);

  if (cards.length === 0 && !templates.length) {
    return (
      <Empty
        description={t('common.superAssistant.agentsEmpty', {
          defaultValue: '还没有数字员工，先创建一个。',
        })}
      />
    );
  }

  return (
    <div className='flex flex-col gap-16px'>
      {templates.length > 0 ? (
        <Card title={t('common.superAssistant.templatesTitle', { defaultValue: '从模板创建' })}>
          <div className='grid gap-12px md:grid-cols-3'>
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type='button'
                disabled={creatingFromTemplate}
                onClick={() => onCreateFromTemplate?.(tpl.id)}
                className='flex flex-col items-start gap-4px rounded-6px border border-border-2 bg-bg-2 p-12px text-left transition hover:border-primary'
              >
                <span className='text-24px'>{tpl.avatar}</span>
                <span className='text-14px font-500'>{getTemplateName(tpl, language)}</span>
                <span className='text-12px text-t-tertiary'>{getTemplateDescription(tpl, language)}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title={t('common.superAssistant.agentsListTitle', { defaultValue: '我的数字员工' })}
        extra={
          <Button type='primary' icon={<Plus />} onClick={onCreateAgent}>
            {t('common.superAssistant.createAgent', { defaultValue: '创建员工' })}
          </Button>
        }
      >
        {cards.length === 0 ? (
          <Empty
            description={t('common.superAssistant.agentsEmptyHint', {
              defaultValue: '从上方模板开始，或点击「创建员工」。',
            })}
          />
        ) : (
          <div className='grid gap-12px md:grid-cols-2'>
            {cards.map((agent) => {
              const ref: AgentCardRef = {
                agentId: agent.id,
                agentName: agent.name,
                agentType: agent.agentType,
              };
              const latestRun = agent.latestRun;
              const expertName = resolveEmployeeExpertName(agent, presetAssistants, localeKey);
              return (
                <Card key={agent.id} size='small'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-8px'>
                      <span className='text-14px font-500'>{agent.name}</span>
                      {expertName ? (
                        <Tag size='small' color='arcoblue'>
                          {expertName}
                        </Tag>
                      ) : null}
                      <Tag size='small' color='gray'>
                        {resolveEmployeeBackendLabel(agent, managedAgentRuntimeCatalog, localeKey)}
                      </Tag>
                      {agent.scheduleEnabled ? (
                        <Tag size='small' color='blue'>
                          <Time className='mr-2px' />
                          {t('common.superAssistant.scheduled', { defaultValue: '定时' })}
                        </Tag>
                      ) : null}
                    </div>
                    {latestRun ? (
                      <Tag size='small' color={RUN_STATUS_COLOR[latestRun.status] ?? 'default'}>
                        {t(`common.superAssistant.runStatus.${latestRun.status}`, {
                          defaultValue: latestRun.status,
                        })}
                      </Tag>
                    ) : null}
                  </div>
                  {agent.description ? (
                    <div className='mt-4px text-12px text-t-tertiary line-clamp-2'>{agent.description}</div>
                  ) : null}
                  {latestRun?.summary ? (
                    <div className='mt-8px rounded-4px bg-bg-2 p-8px text-12px text-t-secondary line-clamp-3'>
                      {latestRun.summary}
                    </div>
                  ) : null}
                  <div className='mt-12px flex flex-wrap gap-8px'>
                    <Button size='small' type='primary' icon={<PlayOne />} onClick={() => onRunAgentNow?.(ref)}>
                      {t('common.superAssistant.runNow', { defaultValue: '立即运行' })}
                    </Button>
                    <Button size='small' icon={<Time />} onClick={() => onScheduleAgent?.(ref)}>
                      {t('common.superAssistant.schedule', { defaultValue: '定时' })}
                    </Button>
                    <Button size='small' icon={<FileText />} onClick={() => onViewDigitalEmployeeDetail?.(ref)}>
                      {t('common.superAssistant.detail', { defaultValue: '详情' })}
                    </Button>
                    <Button size='small' icon={<Edit />} onClick={() => onManageAgent?.(ref)}>
                      {t('common.superAssistant.manage', { defaultValue: '管理' })}
                    </Button>
                    <Popconfirm
                      title={t('common.superAssistant.deleteConfirm', {
                        defaultValue: '确定删除该数字员工？',
                      })}
                      onOk={() => onDeleteAgent?.(ref)}
                    >
                      <Button size='small' icon={<Delete />} status='danger'>
                        {t('common.superAssistant.delete', { defaultValue: '删除' })}
                      </Button>
                    </Popconfirm>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AgentsTab;
