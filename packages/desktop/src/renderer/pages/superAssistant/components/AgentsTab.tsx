/**
 * Agents tab — the employees this member can use, each opened by chat.
 *
 * Company-distributed employees are read-only here: the console owns their
 * definition and the team sync rewrites the local copy, so only the actions
 * that do not change the definition (chat, details) are offered. A member's
 * own employees additionally get schedule / manage / delete.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Pagination, Popconfirm, Tag } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import type { DigitalEmployeeRunRecord } from '@/common/types/employee/employeeTypes';
import { Communication, Delete, Edit, FileText, Plus, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { resolveLocaleKey } from '@/common/utils';
import { useManagedAgentRuntimeCatalog } from '@renderer/hooks/agent/useManagedAgents';
import { useConversationAssistants } from '@renderer/pages/conversation/hooks/useConversationAssistants';
import type { DigitalEmployeeWithRuns } from '../hooks/useDigitalEmployees';
import { resolveEmployeeBackendLabel, resolveEmployeeExpertName } from '../utils/employeeDisplay';
import { resolveEmployeeAvatar } from '../utils/employeeAvatar';

export type AgentCardRef = {
  agentId: string;
  agentName: string;
  agentType: string;
};

type AgentsTabProps = {
  agents: DigitalEmployeeWithRuns[];
  startingChatId?: string | null;
  onStartChat?: (agent: AgentCardRef) => void;
  onCreateAgent?: () => void;
  onManageAgent?: (agent: AgentCardRef) => void;
  onScheduleAgent?: (agent: AgentCardRef) => void;
  onViewDigitalEmployeeDetail?: (agent: AgentCardRef) => void;
  onDeleteAgent?: (agent: AgentCardRef) => Promise<void>;
};

/**
 * `origin === 'team'` is the marker `syncTeamAgents` writes on rows it
 * materialized from the company registry — see the TEAM_ORIGIN constant in
 * dream-core's employee crate. Everything else on the row is deliberately
 * rewritten to look local (owner is the member, visibility private), so this
 * column is the only thing that tells the two apart.
 */
const isTeamDistributed = (agent: { origin?: string | null }): boolean => agent.origin === 'team';

const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'processing',
  success: 'success',
  failed: 'red',
};

const AgentsTab: React.FC<AgentsTabProps> = ({
  agents,
  startingChatId,
  onStartChat,
  onCreateAgent,
  onManageAgent,
  onScheduleAgent,
  onViewDigitalEmployeeDetail,
  onDeleteAgent,
}) => {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const language = i18n.language;
  const localeKey = resolveLocaleKey(language ?? 'en-US');
  const managedAgentRuntimeCatalog = useManagedAgentRuntimeCatalog();
  const { presetAssistants } = useConversationAssistants();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [runsByAgent, setRunsByAgent] = useState<Record<string, DigitalEmployeeRunRecord[]>>({});

  // Company employees first: they are what the member was handed.
  const cards = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return agents
      .filter((agent) =>
        [agent.name, agent.description, resolveEmployeeExpertName(agent, presetAssistants, localeKey)].some((value) =>
          value?.toLocaleLowerCase().includes(query)
        )
      )
      .sort((a, b) => Number(isTeamDistributed(b)) - Number(isTeamDistributed(a)));
  }, [agents, search, presetAssistants, localeKey]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(cards.length / pageSize)));
  const visibleCards = useMemo(
    () => cards.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [cards, currentPage]
  );
  useEffect(() => {
    let active = true;
    // Only the visible page needs run summaries. Fetching one history per
    // employee made a 500-item roster issue 500 concurrent requests.
    void Promise.all(
      visibleCards.map(async (agent) => {
        try {
          return [agent.id, (await ipcBridge.personalAgent.listRuns.invoke({ agentId: agent.id })) ?? []] as const;
        } catch {
          return [agent.id, []] as const;
        }
      })
    ).then((entries) => {
      if (active) setRunsByAgent(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [visibleCards]);

  return (
    <div className='flex flex-col gap-16px'>
      <Card
        title={t('common.superAssistant.agentsListTitle', { defaultValue: '我的数字员工' })}
        extra={
          <Button type='primary' icon={<Plus />} onClick={onCreateAgent}>
            {t('common.superAssistant.createAgent', { defaultValue: '创建员工' })}
          </Button>
        }
      >
        <Input.Search
          className='mb-16px'
          allowClear
          value={search}
          placeholder={t('common.superAssistant.searchEmployees')}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        {cards.length === 0 ? (
          <Empty
            description={
              search.trim()
                ? t('common.superAssistant.noMatchingEmployees')
                : t('common.superAssistant.agentsEmpty', {
                    defaultValue: '还没有数字员工，先创建一个。',
                  })
            }
          />
        ) : (
          <div className='grid gap-12px md:grid-cols-2'>
            {visibleCards.map((agent) => {
              const ref: AgentCardRef = {
                agentId: agent.id,
                agentName: agent.name,
                agentType: agent.agentType,
              };
              // A chat binding has no outcome to report; the card shows the last real run.
              const latestRun = (runsByAgent[agent.id] ?? agent.recentRuns).find((run) => run.triggerSource !== 'chat');
              const expertName = resolveEmployeeExpertName(agent, presetAssistants, localeKey);
              return (
                <Card key={agent.id} size='small'>
                  <div className='flex items-center justify-between'>
                    <div className='flex min-w-0 items-center gap-9px'>
                      <img
                        src={resolveEmployeeAvatar(agent)}
                        alt=''
                        className='h-42px w-42px shrink-0 rd-10px border border-2 object-cover'
                      />
                      <div className='flex min-w-0 flex-wrap items-center gap-6px'>
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
                        {/* Company-distributed employees land in the member's own
                          list with owner/visibility rewritten to look local, so
                          without this tag they are indistinguishable from ones
                          the member built — including the delete button, which
                          the next sync would undo. Same label the skills list
                          already uses for team-distributed rows. */}
                        {isTeamDistributed(agent) ? (
                          <Tag size='small' color='green'>
                            {t('common.superAssistant.teamDistributed', { defaultValue: '团队 · 自动' })}
                          </Tag>
                        ) : null}
                      </div>
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
                    <div className='mt-8px rounded-4px bg-2 p-8px text-12px text-t-secondary line-clamp-3'>
                      {latestRun.summary}
                    </div>
                  ) : null}
                  <div className='mt-12px flex flex-wrap gap-8px'>
                    <Button
                      size='small'
                      type='primary'
                      icon={<Communication />}
                      loading={startingChatId === agent.id}
                      onClick={() => onStartChat?.(ref)}
                    >
                      {t('common.superAssistant.startChat')}
                    </Button>
                    <Button size='small' icon={<FileText />} onClick={() => onViewDigitalEmployeeDetail?.(ref)}>
                      {t('common.superAssistant.detail', { defaultValue: '详情' })}
                    </Button>
                    {/* Scheduling is the member's own choice and the team sync leaves it
                        alone, so company employees get it too. */}
                    <Button size='small' icon={<Time />} onClick={() => onScheduleAgent?.(ref)}>
                      {t('common.superAssistant.schedule', { defaultValue: '定时' })}
                    </Button>
                    {isTeamDistributed(agent) ? null : (
                      <>
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
                      </>
                    )}
                  </div>
                  {isTeamDistributed(agent) ? (
                    <div className='mt-8px text-12px text-t-tertiary'>{t('common.superAssistant.teamManagedHint')}</div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
        {cards.length > pageSize && (
          <Pagination
            className='mt-16px'
            current={currentPage}
            pageSize={pageSize}
            total={cards.length}
            onChange={setPage}
            showTotal
          />
        )}
      </Card>
    </div>
  );
};

export default AgentsTab;
