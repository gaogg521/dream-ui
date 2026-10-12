/**
 * Copyright 2026 One Work
 */

/**
 * Company-distributed digital employees, as a card grid under the Guid
 * composer — the member's main entry to them.
 *
 * An employee is what an administrator built once in the console: a persona,
 * bound skills and connectors, a company model. The member should not have to
 * know any of that; they pick an employee and say what they need. Opening a
 * chat goes through the backend's chat entry, which binds the conversation to
 * the employee so the runtime loads its persona and resources.
 *
 * Rows come from the LOCAL registry: the team sync materializes exactly the
 * employees this member is entitled to (`origin = 'team'`), and removes them
 * when the admin revokes access.
 */

import { ipcBridge } from '@/common';
import type { PersonalAgent } from '@/common/types/employee/employeeTypes';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { resolveEmployeeAvatar } from '@/renderer/pages/superAssistant/utils/employeeAvatar';
import {
  resolveEmployeeStarterPrompts,
  startEmployeeChat,
} from '@/renderer/pages/superAssistant/utils/startEmployeeChat';
import { Button, Message, Tag } from '@arco-design/web-react';
import { ArrowRightUp } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

const TEAM_ORIGIN = 'team';

const countOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

type EmployeeCardProps = {
  agent: PersonalAgent;
  busy: boolean;
  onStart: (agent: PersonalAgent, firstMessage?: string) => void;
};

const EmployeeCard: React.FC<EmployeeCardProps> = ({ agent, busy, onStart }) => {
  const { t } = useTranslation();
  const prompts = resolveEmployeeStarterPrompts(agent);
  const skillCount = countOf(agent.automationConfig?.boundSkillIds);
  const toolCount = countOf(agent.automationConfig?.boundMcpIds);

  return (
    <div
      className='min-w-0 flex flex-col gap-10px rd-14px border border-3 bg-1 p-14px transition-colors
                 duration-150 hover:border-primary'
      data-employee-id={agent.id}
    >
      <div className='flex min-w-0 items-start gap-10px'>
        <img
          src={resolveEmployeeAvatar(agent)}
          alt=''
          className='h-40px w-40px shrink-0 rd-12px border border-3 object-cover'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-6px'>
            <span className='truncate text-14px font-600 leading-20px text-t-primary'>{agent.name}</span>
            <Tag size='small' color='green'>
              {t('common.superAssistant.companyTag')}
            </Tag>
          </div>
          {agent.description ? (
            <div className='mt-2px line-clamp-2 text-12px leading-17px text-t-tertiary' title={agent.description}>
              {agent.description}
            </div>
          ) : null}
        </div>
      </div>

      {prompts.length > 0 ? (
        <div className='flex flex-col gap-2px'>
          {prompts.map((prompt) => (
            <Button
              key={prompt}
              type='text'
              size='mini'
              disabled={busy}
              className='group !h-auto !justify-start !px-0 !py-3px !text-start !text-12px !text-t-secondary
                         !whitespace-normal !break-words hover:!bg-transparent hover:!text-t-primary'
              onClick={() => onStart(agent, prompt)}
            >
              <span>{prompt}</span>
              <ArrowRightUp
                theme='outline'
                size='12'
                className='ms-4px inline-flex flex-shrink-0 align-[-1px] opacity-0 transition-opacity
                           group-hover:opacity-100'
              />
            </Button>
          ))}
        </div>
      ) : null}

      <div className='mt-auto flex items-center justify-between gap-8px border-t border-3 pt-9px'>
        <span className='flex gap-12px text-12px text-t-tertiary'>
          {skillCount > 0 ? <span>{t('common.superAssistant.boundSkillsCount', { count: skillCount })}</span> : null}
          {toolCount > 0 ? <span>{t('common.superAssistant.boundToolsCount', { count: toolCount })}</span> : null}
        </span>
        <Button size='small' type='primary' loading={busy} onClick={() => onStart(agent)}>
          {t('common.superAssistant.startChat')}
        </Button>
      </div>
    </div>
  );
};

const EnterpriseEmployeeGrid: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<string | null>(null);
  const { data: agents } = useSWR<PersonalAgent[]>('guid.team-employees', () => ipcBridge.personalAgent.list.invoke(), {
    shouldRetryOnError: false,
  });
  const team = (agents ?? []).filter((agent) => agent.origin === TEAM_ORIGIN);

  const handleStart = useCallback(
    async (agent: PersonalAgent, firstMessage?: string) => {
      setStarting(agent.id);
      try {
        await startEmployeeChat(agent.id, navigate, firstMessage);
      } catch (error) {
        // 404 is the backend's answer for an employee this member may no
        // longer use — typically access revoked since the last sync.
        Message.error(
          isBackendHttpError(error) && error.status === 404
            ? t('common.superAssistant.employeeUnavailable')
            : `${t('common.superAssistant.startChatFailed')}: ${String(error)}`
        );
      } finally {
        setStarting(null);
      }
    },
    [navigate, t]
  );

  if (team.length === 0) return null;

  return (
    <div className='mt-18px w-full animate-fade-in' data-testid='enterprise-employee-grid'>
      <div className='mb-9px text-center text-12.5px text-t-tertiary'>
        {t('common.superAssistant.homeEmployeesHint')}
      </div>
      <div className='grid grid-cols-1 gap-10px sm:grid-cols-2 lg:grid-cols-3'>
        {team.map((agent) => (
          <EmployeeCard
            key={agent.id}
            agent={agent}
            busy={starting === agent.id}
            onStart={(target, message) => void handleStart(target, message)}
          />
        ))}
      </div>
    </div>
  );
};

export default EnterpriseEmployeeGrid;
