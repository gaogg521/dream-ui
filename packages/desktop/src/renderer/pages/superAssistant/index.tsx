/**
 * Super Assistant page — collaboration kanban backed by digital employees.
 *
 * Kept intentionally narrow: the kanban (issues) tab is the only piece that
 * actually drives an agent (dispatch/breakdown), "agents" manages the
 * digital-employee roster the kanban assigns to, and "registries" is the
 * shared skills/MCP/RAG/milestone context the kanban draws on. A prior
 * overview/runtimes/settings trio was pure navigation chrome duplicating
 * /settings/agent, /settings/model and /settings/enterprise — removed.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button, Message, Spin, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { useDigitalEmployees } from './hooks/useDigitalEmployees';
import { AGENT_TEMPLATES, getTemplateInstructions, getTemplateName } from './templates/agentTemplates';
import AgentsTab, { type AgentCardRef } from './components/AgentsTab';
import IssuesTab from './components/IssuesTab';
import RegistriesTab from './registries/RegistriesTab';
import { useCollaborationContext } from './hooks/useCollaborationContext';
import CreateAgentModal from './components/CreateAgentModal';
import ManageAgentModal from './components/ManageAgentModal';
import ScheduleAgentModal from './components/ScheduleAgentModal';
import DigitalEmployeeDetailModal from './components/DigitalEmployeeDetailModal';
import { deletePersonalDigitalEmployee } from './utils/deleteDigitalEmployee';

const TabKey = {
  ISSUES: 'issues',
  AGENTS: 'agents',
  REGISTRIES: 'registries',
} as const;

type TabKey = (typeof TabKey)[keyof typeof TabKey];

const SuperAssistantPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const tab = searchParams.get('tab');
    return tab && (Object.values(TabKey) as string[]).includes(tab) ? (tab as TabKey) : TabKey.ISSUES;
  });

  const { loading, agents, refresh } = useDigitalEmployees(true);
  const collaborationContext = useCollaborationContext(activeTab === TabKey.ISSUES);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [manageTarget, setManageTarget] = useState<AgentCardRef | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<AgentCardRef | null>(null);
  const [detailTarget, setDetailTarget] = useState<AgentCardRef | null>(null);
  const [creatingFromTemplate, setCreatingFromTemplate] = useState(false);

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

  const handleRunNow = useCallback(
    async (ref: AgentCardRef) => {
      try {
        await ipcBridge.personalAgent.runNow.invoke({ agentId: ref.agentId });
        Message.success(t('common.superAssistant.runNowStarted', { defaultValue: '已触发，运行中…' }));
        // Give the backend a moment to insert the run row before refreshing.
        setTimeout(() => void refresh(), 500);
      } catch (error) {
        Message.error(t('common.superAssistant.runNowFailed', { defaultValue: '触发失败' }) + ': ' + String(error));
      }
    },
    [refresh, t]
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
        await ipcBridge.personalAgent.create.invoke({
          name,
          agentType,
          automationConfig: instructions ? { instructions } : {},
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
      <div className='flex items-center justify-between border-b border-border-2 px-16px py-12px'>
        <div className='text-16px font-600'>{t('common.superAssistant.title', { defaultValue: '超级助手' })}</div>
        <Button type='primary' onClick={() => setCreateModalVisible(true)}>
          {t('common.superAssistant.createAgent', { defaultValue: '创建员工' })}
        </Button>
      </div>
      <div className='flex-1 overflow-auto p-16px'>
        <Spin loading={loading}>
          <Tabs activeTab={activeTab} onChange={(key) => setActiveTab(key as TabKey)}>
            <Tabs.TabPane
              key={TabKey.ISSUES}
              title={t('common.superAssistant.tabIssues', { defaultValue: '协作看板' })}
            >
              <IssuesTab
                collaborationContext={collaborationContext}
                employees={agents}
                onOpenRegistries={() => setActiveTab(TabKey.REGISTRIES)}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key={TabKey.AGENTS} title={t('common.superAssistant.tabAgents', { defaultValue: '员工' })}>
              <AgentsTab
                agents={agents}
                onCreateAgent={() => setCreateModalVisible(true)}
                onCreateFromTemplate={handleCreateFromTemplate}
                creatingFromTemplate={creatingFromTemplate}
                onManageAgent={(ref) => setManageTarget(ref)}
                onRunAgentNow={handleRunNow}
                onScheduleAgent={(ref) => setScheduleTarget(ref)}
                onViewDigitalEmployeeDetail={(ref) => setDetailTarget(ref)}
                onDeleteAgent={handleDelete}
              />
            </Tabs.TabPane>
            <Tabs.TabPane
              key={TabKey.REGISTRIES}
              title={t('common.superAssistant.tabRegistries', { defaultValue: '协作资源' })}
            >
              <RegistriesTab />
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
      />
    </div>
  );
};

export default SuperAssistantPage;
