/**
 * Digital employees page — the roster of employees this member can use, plus
 * the knowledge base they draw on.
 *
 * The everyday entry to an employee is the home page grid
 * (`EnterpriseEmployeeGrid`): pick one, say what you need. This page is where
 * a member reads what an employee carries, schedules their own employees, and
 * builds personal ones. The former collaboration kanban (issues, dispatch,
 * milestones, pipelines, test plans) is gone: dispatch never wrote its result
 * back, so the board showed work that went nowhere, and multi-agent
 * collaboration lives in team mode. The skills / MCP / scenes views it carried
 * duplicated pages that already exist (`/settings/skills`, `/mcp`, the home
 * scene grid); the knowledge base stays because no other page manages it.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Message, Spin, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { isOrgAdminRole, useOrgContext } from '../enterprise/hooks/useOrgContext';
import { useDigitalEmployees } from './hooks/useDigitalEmployees';
import {
  AGENT_TEMPLATES,
  getTemplateExamplePrompts,
  getTemplateInstructions,
  getTemplateName,
} from './templates/agentTemplates';
import AgentsTab, { type AgentCardRef } from './components/AgentsTab';
import RagSection from './registries/RagSection';
import CreateAgentModal from './components/CreateAgentModal';
import ManageAgentModal from './components/ManageAgentModal';
import ScheduleAgentModal from './components/ScheduleAgentModal';
import DigitalEmployeeDetailModal from './components/DigitalEmployeeDetailModal';
import { deletePersonalDigitalEmployee } from './utils/deleteDigitalEmployee';
import { startEmployeeChat } from './utils/startEmployeeChat';

const TabKey = {
  AGENTS: 'agents',
  KNOWLEDGE: 'knowledge',
} as const;

type TabKey = (typeof TabKey)[keyof typeof TabKey];

/** Links into the former tabs keep landing somewhere sensible. */
function resolveInitialTab(param: string | null): TabKey {
  if (param === TabKey.KNOWLEDGE || param === 'registries') return TabKey.KNOWLEDGE;
  return TabKey.AGENTS;
}

const SuperAssistantPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() => resolveInitialTab(searchParams.get('tab')));
  const { context } = useOrgContext();
  // The knowledge base is org-scoped inside an enterprise; only an admin may
  // change it there. A personal user manages their own outright.
  const knowledgeReadOnly = Boolean(context?.isEnterprise) && !isOrgAdminRole(context?.role);

  const { loading, agents, refresh } = useDigitalEmployees(true);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [manageTarget, setManageTarget] = useState<AgentCardRef | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<AgentCardRef | null>(null);
  const [detailTarget, setDetailTarget] = useState<AgentCardRef | null>(null);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);
  const [startingChat, setStartingChat] = useState<string | null>(null);

  const manageAgentRow = useMemo(
    () => agents.find((agent) => agent.id === manageTarget?.agentId) ?? null,
    [agents, manageTarget]
  );
  const scheduleAgentRow = useMemo(
    () => agents.find((agent) => agent.id === scheduleTarget?.agentId) ?? null,
    [agents, scheduleTarget]
  );
  const detailAgentRow = useMemo(
    () => agents.find((agent) => agent.id === detailTarget?.agentId) ?? null,
    [agents, detailTarget]
  );

  const handleStartChat = useCallback(
    async (agentId: string, firstMessage?: string) => {
      setStartingChat(agentId);
      try {
        await startEmployeeChat(agentId, navigate, firstMessage);
      } catch (error) {
        Message.error(
          isBackendHttpError(error) && error.status === 404
            ? t('common.superAssistant.employeeUnavailable')
            : `${t('common.superAssistant.startChatFailed')}: ${String(error)}`
        );
      } finally {
        setStartingChat(null);
      }
    },
    [navigate, t]
  );

  const handleDelete = useCallback(
    async (ref: AgentCardRef) => {
      try {
        await deletePersonalDigitalEmployee({ agentId: ref.agentId });
        Message.success(t('common.superAssistant.deleteSuccess', { defaultValue: '已删除' }));
        void refresh();
      } catch (error) {
        Message.error(t('common.superAssistant.deleteFailed', { defaultValue: '删除失败' }) + ': ' + String(error));
      }
    },
    [refresh, t]
  );

  const handleCreateFromTemplate = useCallback(
    async (templateId: string) => {
      const template = AGENT_TEMPLATES.find((tpl) => tpl.id === templateId);
      if (!template) {
        return;
      }
      setCreatingFromTemplate(true);
      try {
        const instructions = getTemplateInstructions(template, language);
        const name = getTemplateName(template, language);
        const agentType = template.agentKey ?? 'claude';
        const starterPrompts = getTemplateExamplePrompts(template, language);
        await ipcBridge.personalAgent.create.invoke({
          name,
          agentType,
          automationConfig: {
            ...(instructions ? { instructions } : {}),
            ...(starterPrompts.length > 0 ? { starterPrompts } : {}),
          },
        });
        Message.success(t('common.superAssistant.createSuccess', { defaultValue: '创建成功' }));
        void refresh();
      } catch (error) {
        Message.error(t('common.superAssistant.createFailed', { defaultValue: '创建失败' }) + ': ' + String(error));
      } finally {
        setCreatingFromTemplate(false);
      }
    },
    [language, refresh, t]
  );

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-b border-2 px-16px py-12px'>
        <div className='text-16px font-600'>{t('common.superAssistant.title', { defaultValue: '数字员工' })}</div>
        <Button type='primary' onClick={() => setCreateModalVisible(true)}>
          {t('common.superAssistant.createAgent', { defaultValue: '创建员工' })}
        </Button>
      </div>
      <div className='flex-1 overflow-auto p-16px'>
        <Spin loading={loading} className='w-full'>
          <Tabs activeTab={activeTab} onChange={(key) => setActiveTab(key as TabKey)}>
            <Tabs.TabPane key={TabKey.AGENTS} title={t('common.superAssistant.tabAgents', { defaultValue: '员工' })}>
              <AgentsTab
                agents={agents}
                startingChatId={startingChat}
                onStartChat={(ref) => void handleStartChat(ref.agentId)}
                onCreateAgent={() => setCreateModalVisible(true)}
                onCreateFromTemplate={handleCreateFromTemplate}
                creatingFromTemplate={creatingFromTemplate}
                onManageAgent={(ref) => setManageTarget(ref)}
                onScheduleAgent={(ref) => setScheduleTarget(ref)}
                onViewDigitalEmployeeDetail={(ref) => setDetailTarget(ref)}
                onDeleteAgent={handleDelete}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key={TabKey.KNOWLEDGE} title={t('common.superAssistant.tabKnowledge')}>
              <RagSection readOnly={knowledgeReadOnly} />
            </Tabs.TabPane>
          </Tabs>
        </Spin>
      </div>

      <CreateAgentModal
        visible={createModalVisible}
        onClose={() => setCreateModalVisible(false)}
        onCreated={() => void refresh()}
      />
      <ManageAgentModal
        visible={manageTarget !== null}
        agent={manageAgentRow}
        onClose={() => setManageTarget(null)}
        onSaved={() => void refresh()}
      />
      <ScheduleAgentModal
        visible={scheduleTarget !== null}
        agent={scheduleAgentRow}
        onClose={() => setScheduleTarget(null)}
        onSaved={() => void refresh()}
      />
      <DigitalEmployeeDetailModal
        visible={detailTarget !== null}
        agent={detailAgentRow}
        onClose={() => setDetailTarget(null)}
        onStartChat={(agentId, firstMessage) => {
          setDetailTarget(null);
          void handleStartChat(agentId, firstMessage);
        }}
      />
    </div>
  );
};

export default SuperAssistantPage;
