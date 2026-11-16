/**
 * Agents tab — the employees this member can use, each opened by chat.
 *
 * Company-distributed employees are read-only here: the console owns their
 * definition and the team sync rewrites the local copy, so only the actions
 * that do not change the definition (chat, details) are offered. A member's
 * own employees additionally get schedule / manage / delete.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Pagination, Popconfirm, Tag, Tooltip } from '@arco-design/web-react';
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
    <div className='flex flex-col gap-16px' data-testid='agents-tab'>
      {/* Same shape as the scenes tab: one line saying what this is, the add button beside it. */}
      <div className='flex items-center justify-between gap-12px'>
        <span className='text-12px text-t-tertiary'>{t('common.superAssistant.tabHint')}</span>
        <div className='flex shrink-0 items-center gap-12px'>
          {agents.length > 0 ? (
            <span className='text-12px text-t-secondary'>
              {t('common.superAssistant.employeeCount', { total: agents.length })}
            </span>
          ) : null}
          <Button
            type='primary'
            icon={<Plus size={14} fill='currentColor' />}
            onClick={onCreateAgent}
            data-testid='employee-new'
          >
            {t('common.superAssistant.createAgent', { defaultValue: '创建员工' })}
          </Button>
        </div>
      </div>

      <section className='flex flex-col gap-8px'>
        <div className='text-13px font-600'>
          {t('common.superAssistant.agentsListTitle', { defaultValue: '我的数字员工' })}
        </div>
        <Input.Search
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
          <div className='grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-10px'>
            {visibleCards.map((agent) => {
              const ref: AgentCardRef = {
                agentId: agent.id,
                agentName: agent.name,
                agentType: agent.agentType,
              };
              // A chat binding has no outcome to report; the card shows the last real run.
              const latestRun = (runsByAgent[agent.id] ?? agent.recentRuns).find((run) => run.triggerSource !== 'chat');
              const expertName = resolveEmployeeExpertName(agent, presetAssistants, localeKey);
              const teamManaged = isTeamDistributed(agent);
              return (
                <div
                  key={agent.id}
                  data-employee-row={agent.name}
                  className='group flex flex-col gap-8px rounded-8px border border-solid border-[var(--color-border-2)] bg-2 p-12px transition-colors hover:border-[rgba(var(--primary-6),0.45)]'
                >
                  <div className='flex items-start gap-10px'>
                    <img
                      src={resolveEmployeeAvatar(agent)}
                      alt=''
                      className='h-40px w-40px shrink-0 rd-10px object-cover'
                    />
                    <div className='min-w-0 flex-1'>
                      <div className='flex min-w-0 items-center justify-between gap-8px'>
                        <span className='truncate text-14px font-600 leading-20px text-t-primary'>{agent.name}</span>
                        {latestRun ? (
                          <Tag size='small' color={RUN_STATUS_COLOR[latestRun.status] ?? 'default'}>
                            {t(`common.superAssistant.runStatus.${latestRun.status}`, {
                              defaultValue: latestRun.status,
                            })}
                          </Tag>
                        ) : null}
                      </div>
                      <div className='mt-2px flex flex-wrap items-center gap-4px'>
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
                        {/* Company-distributed employees land in the member's own list with
                            owner/visibility rewritten to look local, so without this tag they
                            are indistinguishable from ones the member built, including the
                            delete action, which the next sync would undo. */}
                        {teamManaged ? (
                          <Tag size='small' color='green'>
                            {t('common.superAssistant.teamDistributed', { defaultValue: '团队 · 自动' })}
                          </Tag>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {agent.description ? (
                    <div className='line-clamp-2 text-12px leading-18px text-t-secondary'>{agent.description}</div>
                  ) : null}
                  {latestRun?.summary ? (
                    <div className='line-clamp-2 rounded-6px bg-fill-1 px-8px py-4px text-12px leading-18px text-t-tertiary'>
                      {latestRun.summary}
                    </div>
                  ) : null}
                  {teamManaged ? (
                    <div className='line-clamp-1 text-12px text-t-tertiary'>
                      {t('common.superAssistant.teamManagedHint')}
                    </div>
                  ) : null}

                  <div className='mt-auto flex items-center justify-between gap-8px border-0 border-t border-solid border-[var(--color-border-2)] pt-8px'>
                    <Button
                      type='primary'
                      size='small'
                      icon={<Communication size={14} fill='currentColor' />}
                      loading={startingChatId === agent.id}
                      onClick={() => onStartChat?.(ref)}
                      data-testid='employee-start'
                    >
                      {t('common.superAssistant.startChat')}
                    </Button>
                    <div className='flex shrink-0 items-center'>
                      <Tooltip content={t('common.superAssistant.detail', { defaultValue: '详情' })}>
                        <Button
                          type='text'
                          size='small'
                          icon={<FileText size={15} />}
                          aria-label={t('common.superAssistant.detail', { defaultValue: '详情' })}
                          onClick={() => onViewDigitalEmployeeDetail?.(ref)}
                        />
                      </Tooltip>
                      {/* Scheduling is the member's own choice and the team sync leaves it
                          alone, so company employees get it too. */}
                      <Tooltip content={t('common.superAssistant.schedule', { defaultValue: '调度与通知' })}>
                        <Button
                          type='text'
                          size='small'
                          icon={<Time size={15} />}
                          aria-label={t('common.superAssistant.schedule', { defaultValue: '调度与通知' })}
                          onClick={() => onScheduleAgent?.(ref)}
                        />
                      </Tooltip>
                      {teamManaged ? null : (
                        <>
                          <Tooltip content={t('common.superAssistant.manage', { defaultValue: '管理' })}>
                            <Button
                              type='text'
                              size='small'
                              icon={<Edit size={15} />}
                              aria-label={t('common.superAssistant.manage', { defaultValue: '管理' })}
                              onClick={() => onManageAgent?.(ref)}
                            />
                          </Tooltip>
                          <Popconfirm
                            title={t('common.superAssistant.deleteConfirm', {
                              defaultValue: '确定删除该数字员工？',
                            })}
                            onOk={() => onDeleteAgent?.(ref)}
                          >
                            <Button
                              type='text'
                              size='small'
                              status='danger'
                              icon={<Delete size={15} />}
                              aria-label={t('common.superAssistant.delete', { defaultValue: '删除' })}
                            />
                          </Popconfirm>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {cards.length > pageSize && (
          <Pagination
            className='mt-8px'
            current={currentPage}
            pageSize={pageSize}
            total={cards.length}
            onChange={setPage}
            showTotal
          />
        )}
      </section>
    </div>
  );
};

export default AgentsTab;
