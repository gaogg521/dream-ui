/**
 * Digital employees and scenes page — the roster of employees this member can
 * use, the scenes they can start work from (their own and, when a company is
 * connected, the company's), and the knowledge base they draw on.
 *
 * Open one with "start chat" and say what you need; the backend binds the
 * conversation to the employee so its persona and resources load. This page is
 * also where a member reads what an employee carries, schedules it (company
 * employees included — that choice is the member's own and the team sync
 * leaves it alone), and builds personal ones. It is deliberately not on the
 * home page: the home page's room goes to the scenes. The former collaboration kanban (issues, dispatch,
 * milestones, pipelines, test plans) is gone: dispatch never wrote its result
 * back, so the board showed work that went nowhere, and multi-agent
 * collaboration lives in team mode. The skills / MCP / scenes views it carried
 * duplicated pages that already exist (`/settings/skills`, `/mcp`, the home
 * scene grid); the knowledge base stays because no other page manages it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Message, Spin, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { useDigitalEmployees } from './hooks/useDigitalEmployees';
import AgentsTab, { type AgentCardRef } from './components/AgentsTab';
import RagSection from './registries/RagSection';
import ScenesTab from './components/ScenesTab';
import CreateAgentModal from './components/CreateAgentModal';
import ManageAgentModal from './components/ManageAgentModal';
import ScheduleAgentModal from './components/ScheduleAgentModal';
import DigitalEmployeeDetailModal from './components/DigitalEmployeeDetailModal';
import { deletePersonalDigitalEmployee } from './utils/deleteDigitalEmployee';
import { startEmployeeChat } from './utils/startEmployeeChat';

const TabKey = {
  AGENTS: 'agents',
  SCENES: 'scenes',
  KNOWLEDGE: 'knowledge',
} as const;

type TabKey = (typeof TabKey)[keyof typeof TabKey];

/** Links into the former tabs keep landing somewhere sensible. */
function resolveInitialTab(param: string | null): TabKey {
  if (param === TabKey.KNOWLEDGE || param === 'registries') return TabKey.KNOWLEDGE;
  if (param === TabKey.SCENES) return TabKey.SCENES;
  return TabKey.AGENTS;
}

const SuperAssistantPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() => resolveInitialTab(searchParams.get('tab')));
  // A link with ?tab= switches the tab even when this page is already open.
  const tabParam = searchParams.get('tab');
  useEffect(() => {
    if (tabParam) setActiveTab(resolveInitialTab(tabParam));
  }, [tabParam]);
  // The knowledge base is org-scoped inside an enterprise; only an admin may
  // change it there. A personal user manages their own outright.

  const { loading, agents, refresh } = useDigitalEmployees(true);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [manageTarget, setManageTarget] = useState<AgentCardRef | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<AgentCardRef | null>(null);
  const [detailTarget, setDetailTarget] = useState<AgentCardRef | null>(null);
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
                onManageAgent={(ref) => setManageTarget(ref)}
                onScheduleAgent={(ref) => setScheduleTarget(ref)}
                onViewDigitalEmployeeDetail={(ref) => setDetailTarget(ref)}
                onDeleteAgent={handleDelete}
              />
            </Tabs.TabPane>
            <Tabs.TabPane key={TabKey.SCENES} title={t('common.scenes.tabTitle')}>
              <ScenesTab />
            </Tabs.TabPane>
            <Tabs.TabPane key={TabKey.KNOWLEDGE} title={t('common.superAssistant.tabKnowledge')}>
              <RagSection />
            </Tabs.TabPane>
          </Tabs>
        </Spin>
      </div>

      <CreateAgentModal
        visible={createModalVisible}
        onClose={() => {
          setCreateModalVisible(false);
        }}
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
