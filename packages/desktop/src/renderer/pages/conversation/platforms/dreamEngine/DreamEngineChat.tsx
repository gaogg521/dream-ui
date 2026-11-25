/**
 * Copyright 2026 One Work
 */

import type { IConversationMcpStatus } from '@/common/config/storage';
import type { ChatFileRef } from '@/common/types/chatFile';
import type { ConversationContextValue } from '@/renderer/hooks/context/ConversationContext';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { CHAT_SURFACE_CONTAINER_CLASS } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import FlexFullContainer from '@renderer/components/layout/FlexFullContainer';
import MessageList from '@renderer/pages/conversation/Messages/MessageList';
import { ConversationArtifactProvider } from '@renderer/pages/conversation/Messages/artifacts';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
  useMessageList,
  useMessageLstCache,
} from '@renderer/pages/conversation/Messages/hooks';
import { usePendingConfirmationsRecovery } from '@renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';
import HOC from '@renderer/utils/ui/HOC';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import DreamEngineSendBox from './DreamEngineSendBox';
import { backgroundTaskTitle, stripBackgroundCollaboration } from '@/common/chat/backgroundCollaboration';
import { TaskChecklist } from '@renderer/pages/conversation/Messages/components/MessagePlan';
import type { DreamEngineModelSelection } from './useDreamEngineModelSelection';

function BackgroundTaskChecklist() {
  const messages = useMessageList();
  const { t, i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'zh-CN';
  const entries = useMemo(() => {
    const lastUser = messages.findLastIndex((message) => message.type === 'text' && message.position === 'right');
    const request = messages[lastUser];
    if (request?.type !== 'text') return [];
    const content = request.content.content;
    if (typeof content !== 'string' || stripBackgroundCollaboration(content) === content) return [];
    const tasksByName = new Map<string, { title?: string; status: 'failed' | 'completed' | 'in_progress' }>();
    for (const message of messages.slice(lastUser + 1)) {
      if (message.type !== 'tool_call' || message.content.name?.toLowerCase() !== 'spawn') continue;
      const { args, input, output, status } = message.content;
      const tasks: unknown = input?.tasks ?? args?.tasks;
      if (!Array.isArray(tasks)) continue;
      for (const task of tasks) {
        const name = typeof task?.name === 'string' ? task.name.trim() : '';
        if (!name) continue;
        const failed = status === 'error' || output?.includes(`## ${name} [ERROR]`);
        tasksByName.set(name, {
          title: backgroundTaskTitle(name, task.prompt, locale) ?? tasksByName.get(name)?.title,
          status: failed ? 'failed' : status === 'completed' ? 'completed' : 'in_progress',
        });
      }
    }
    return Array.from(tasksByName.values(), ({ title, status }) => ({
      content: title ?? t('messages.backgroundTask', { defaultValue: 'Subtask' }),
      status,
    }));
  }, [messages, locale, t]);

  return <TaskChecklist entries={entries} compact />;
}

const DreamEngineChat: React.FC<{
  conversation_id: string;
  workspace: string;
  modelSelection: DreamEngineModelSelection;
  session_mode?: string;
  cron_job_id?: string;
  emptySlot?: React.ReactNode;
  taskChecklist?: React.ReactNode;
  loadedSkills?: string[];
  loadedMcpServers?: string[];
  loadedMcpStatuses?: IConversationMcpStatus[];
  agent_name?: string;
  teamSendMessage?: (payload: { input: string; files: ChatFileRef[] }) => Promise<void>;
  teamRuntime?: TeamSendBoxRuntime;
  assistantId?: string;
  forkCapability?: { at_turn: boolean };
}> = ({
  conversation_id,
  workspace,
  modelSelection,
  session_mode,
  cron_job_id,
  emptySlot,
  taskChecklist,
  loadedSkills,
  loadedMcpServers,
  loadedMcpStatuses,
  agent_name,
  teamSendMessage,
  teamRuntime,
  assistantId,
  forkCapability,
}) => {
  useMessageLstCache(conversation_id);
  usePendingConfirmationsRecovery(conversation_id);
  const conversationValue = useMemo<ConversationContextValue>(() => {
    return {
      conversation_id: conversation_id,
      workspace,
      type: 'dream',
      cron_job_id,
      loadedSkills,
      loadedMcpServers,
      loadedMcpStatuses,
      assistantId,
      forkCapability,
    };
  }, [
    conversation_id,
    workspace,
    cron_job_id,
    loadedSkills,
    loadedMcpServers,
    loadedMcpStatuses,
    assistantId,
    forkCapability,
  ]);

  return (
    <ConversationProvider value={conversationValue}>
      <ConversationArtifactProvider conversation_id={conversation_id}>
        <div className={`${CHAT_SURFACE_CONTAINER_CLASS} flex-1 flex flex-col px-20px min-h-0`}>
          <FlexFullContainer>
            <MessageList className='flex-1' emptySlot={emptySlot} />
          </FlexFullContainer>
          {taskChecklist ?? (!teamRuntime && !teamSendMessage && <BackgroundTaskChecklist />)}
          <DreamEngineSendBox
            conversation_id={conversation_id}
            modelSelection={modelSelection}
            session_mode={session_mode}
            agent_name={agent_name}
            teamSendMessage={teamSendMessage}
            teamRuntime={teamRuntime}
          />
        </div>
      </ConversationArtifactProvider>
    </ConversationProvider>
  );
};

export default HOC.Wrapper(MessageListProvider, MessageListLoadingProvider, MessagePaginationProvider)(DreamEngineChat);
